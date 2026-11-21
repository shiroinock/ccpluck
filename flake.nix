{
  description = "ccpluck: pick, apply and roll back individual Claude Code settings.json items";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      lib = nixpkgs.lib;
      systems = [
        "aarch64-darwin"
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      ccpluckFor =
        pkgs:
        let
          nodejs = pkgs.nodejs_22;
          pnpm = pkgs.pnpm_10;
        in
        pkgs.stdenv.mkDerivation (finalAttrs: {
          pname = "ccpluck";
          version = (lib.importJSON ./packages/cli/package.json).version;

          # flake のソースは git で追跡しているファイルだけ（node_modules と dist は入らない）
          src = lib.cleanSource ./.;

          # 依存は pnpm-lock.yaml から固定ハッシュで取る。ビルド中はネットワークに出ない
          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit (finalAttrs) pname version src;
            inherit pnpm;
            fetcherVersion = 3;
            hash = "sha256-CZ+zJ9aEt81noyL9ZWKv9bEc8EurAIIWvQmSvDHm89w=";
          };

          nativeBuildInputs = [
            nodejs
            pnpm
            pkgs.pnpmConfigHook
            pkgs.makeWrapper
          ];

          buildPhase = ''
            runHook preBuild
            pnpm --filter @ccpluck/core --filter ccpluck run build
            runHook postBuild
          '';

          # テストは一時ディレクトリだけを使う（GitHub バックエンドのテストは手元の bare リポジトリに git を使う）
          doCheck = true;
          nativeCheckInputs = [ pkgs.git ];
          checkPhase = ''
            runHook preCheck
            pnpm --filter @ccpluck/core --filter ccpluck run test
            runHook postCheck
          '';

          # CLI の実行時の依存は @ccpluck/core だけ。node_modules の形にして置き、node で起動する
          installPhase = ''
            runHook preInstall
            lib=$out/lib/ccpluck
            mkdir -p $lib/node_modules/@ccpluck/core $out/bin
            cp -r packages/cli/package.json packages/cli/dist $lib/
            cp -r packages/core/package.json packages/core/dist $lib/node_modules/@ccpluck/core/
            # GitHub バックエンドは git を使う（gh はトークンを借りるときだけ。PATH にあれば使う）
            makeWrapper ${lib.getExe nodejs} $out/bin/ccpluck \
              --add-flags $lib/dist/bin.js \
              --prefix PATH : ${lib.makeBinPath [ pkgs.git ]}
            runHook postInstall
          '';

          meta = {
            description = "Pick, apply and roll back individual Claude Code settings.json items";
            homepage = "https://github.com/shiroinock/ccpluck";
            license = lib.licenses.mit;
            mainProgram = "ccpluck";
            platforms = systems;
          };
        });
    in
    {
      packages = forAllSystems (pkgs: rec {
        ccpluck = ccpluckFor pkgs;
        default = ccpluck;
      });

      apps = forAllSystems (pkgs: {
        default = {
          type = "app";
          program = lib.getExe self.packages.${pkgs.stdenv.hostPlatform.system}.default;
          meta.description = "ccpluck CLI";
        };
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.pnpm_10
            pkgs.git
          ];
        };
      });

      # nix flake check でビルドとテスト（checkPhase）を通す
      checks = forAllSystems (pkgs: {
        ccpluck = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}

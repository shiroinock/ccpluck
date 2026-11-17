// 自動生成: scripts/update-schema.mjs で更新する。手で編集しない。
// source: https://json.schemastore.org/claude-code-settings.json

export interface SchemaKeyInfo {
  type: string | null;
  description: string;
}

export const TOP_LEVEL_KEYS: Record<string, SchemaKeyInfo> = {
  "$schema": {
    "type": "string",
    "description": "JSON Schema reference for Claude Code settings"
  },
  "apiKeyHelper": {
    "type": "string",
    "description": "Path to a script that outputs authentication values"
  },
  "autoMemoryEnabled": {
    "type": "boolean",
    "description": "Enable automatic memory saves that capture useful context to ~/.claude/projects/<project>/memory/ (derived from the git repository, shared across worktrees). Also configurable via CLAUDE_CODE_DISABLE_AUTO_MEMORY environment variable (set to 1 to disable, 0 to enable)"
  },
  "autoUpdatesChannel": {
    "type": "string",
    "description": "Release channel to follow for updates. Use \"stable\" for a version that is typically about one week old and skips versions with major regressions, or \"latest\" (default) for the most recent release. Set DISABLE_AUTOUPDATER=1 to disable background auto-updates, or DISABLE_UPDATES=1 (added in v2.1.118) "
  },
  "awsCredentialExport": {
    "type": "string",
    "description": "Command that outputs AWS credentials as JSON (in the form {\"Credentials\": {\"AccessKeyId\": ..., \"SecretAccessKey\": ..., \"SessionToken\": ...}}). The output is captured silently. Use when you cannot modify the .aws directory and must return credentials directly"
  },
  "awsAuthRefresh": {
    "type": "string",
    "description": "Command to run when AWS credentials are expired or unavailable; its output is shown to the user but interactive input is not supported. Also drives the \"Claude Platform on AWS · refresh credentials\" option in /login when configured"
  },
  "claudeMdExcludes": {
    "type": "array",
    "description": "Glob patterns for CLAUDE.md files to exclude from loading. Useful in monorepos to skip irrelevant instructions from other teams. Patterns match against absolute file paths. Arrays merge across settings layers. Managed policy CLAUDE.md files cannot be excluded"
  },
  "cleanupPeriodDays": {
    "type": "integer",
    "description": "Number of days to retain sessions, orphaned subagent worktrees, tasks, shell snapshots, and backups. Minimum is 1; setting 0 is rejected with a validation error"
  },
  "env": {
    "type": "object",
    "description": "Environment variables to set for Claude Code sessions. Many environment variables provide settings dimensions not available as dedicated settings.json properties (e.g., thinking tokens, prompt caching, bash timeouts, shell configuration)"
  },
  "attribution": {
    "type": "object",
    "description": "Customize attribution for git commits and pull requests"
  },
  "includeGitInstructions": {
    "type": "boolean",
    "description": "Include built-in git commit and PR workflow instructions in Claude's system prompt. Also configurable via CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS environment variable (set to 1 to disable)"
  },
  "includeCoAuthoredBy": {
    "type": "boolean",
    "description": "DEPRECATED. Use 'attribution' instead. Whether to include the co-authored-by Claude byline in git commits and pull requests (default: true)"
  },
  "plansDirectory": {
    "type": "string",
    "description": "Customize where plan files are stored. Path is relative to project root (default: ~/.claude/plans)"
  },
  "respectGitignore": {
    "type": "boolean",
    "description": "Control whether the @ file picker respects .gitignore patterns. When true (default), files matching .gitignore patterns are excluded from suggestions"
  },
  "permissions": {
    "type": "object",
    "description": "Tool usage permissions configuration.\nSee https://code.claude.com/docs/en/permissions and https://code.claude.com/docs/en/settings#permission-settings\nSee https://code.claude.com/docs/en/tools-reference for full list of tools available to Claude."
  },
  "language": {
    "type": "string",
    "description": "Configure Claude's preferred response language (e.g., \"japanese\", \"spanish\", \"french\"). Claude will respond in this language by default. Also sets the voice dictation language and terminal tab session title generation"
  },
  "model": {
    "type": "string",
    "description": "Override the default model used by Claude Code. For finer control, use environment variables: ANTHROPIC_MODEL (runtime override), ANTHROPIC_DEFAULT_OPUS_MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL, ANTHROPIC_DEFAULT_HAIKU_MODEL (per-class pinning), CLAUDE_CODE_SUBAGENT_MODEL (subagent model)"
  },
  "availableModels": {
    "type": "array",
    "description": "Restrict which models users can select. When defined at multiple settings levels (user, project, etc.), arrays are merged and deduplicated"
  },
  "modelOverrides": {
    "type": "object",
    "description": "Map Anthropic model IDs to provider-specific model IDs such as Bedrock inference profile ARNs, Vertex AI version names, or Foundry deployment names. Each model picker entry uses its mapped value when calling the provider API. Unknown keys are ignored"
  },
  "effortLevel": {
    "type": "string",
    "description": "Persist adaptive reasoning effort across sessions. Set to low, medium, high, or xhigh; max and ultracode are session-only and are not accepted in the settings file (use the CLAUDE_CODE_EFFORT_LEVEL environment variable or /effort for a session-only max). Effort is supported on Fable 5, Opus 4.8, Opu"
  },
  "fastMode": {
    "type": "boolean",
    "description": "Enable fast mode, which uses Claude Opus 5 by default (since v2.1.219) for faster output at higher per-token cost without downgrading to a smaller model. Requires extra usage enabled. Toggle with the /fast command. Supported on Opus 5 and Opus 4.8; fast mode for Opus 4.7 was deprecated on June 25, 2"
  },
  "fastModePerSessionOptIn": {
    "type": "boolean",
    "description": "Require per-session opt-in for fast mode. When true, fast mode does not persist across sessions and users must enable it with /fast each session. Useful for controlling costs"
  },
  "feedbackSurveyRate": {
    "type": "number",
    "description": "Probability (0–1) that the session quality survey appears when eligible. A value of 0.05 means 5% of eligible sessions"
  },
  "enableAllProjectMcpServers": {
    "type": "boolean",
    "description": "Whether to automatically approve all MCP servers in the project"
  },
  "enabledMcpjsonServers": {
    "type": "array",
    "description": "List of approved MCP servers from .mcp.json"
  },
  "disabledMcpjsonServers": {
    "type": "array",
    "description": "List of rejected MCP servers from .mcp.json"
  },
  "allowedMcpServers": {
    "type": "array",
    "description": "Enterprise allowlist of MCP servers that can be used. Applies to all scopes including enterprise servers from managed-mcp.json. If undefined, all servers are allowed. If empty array, no servers are allowed. Denylist takes precedence - if a server is on both lists, it is denied"
  },
  "deniedMcpServers": {
    "type": "array",
    "description": "Enterprise denylist of MCP servers that are explicitly blocked. If a server is on the denylist, it will be blocked across all scopes including enterprise. Denylist takes precedence over allowlist - if a server is on both lists, it is denied"
  },
  "httpHookAllowedEnvVars": {
    "type": "array",
    "description": "Allowlist of environment variable names HTTP hooks may interpolate into headers. When set, each hook's effective allowedEnvVars is the intersection with this list. Undefined = no restriction. Arrays merge across settings sources"
  },
  "hooks": {
    "type": "object",
    "description": "Lifecycle event hooks that run at configurable points during Claude Code operation (tool use, session start/end, notifications, prompt submit, message display, and more), not just before/after tool executions"
  },
  "disableAllHooks": {
    "type": "boolean",
    "description": "Disable all hooks and statusLine execution. When true in managed settings, user and project-level disableAllHooks cannot override it"
  },
  "allowedChannelPlugins": {
    "type": "array",
    "description": "(Managed settings only) Allowlist of channel plugins that may run, each identified by its marketplace and plugin name. When set, only the listed plugins can push inbound channel messages while channelsEnabled is true. Replaces the default Anthropic allowlist when set; undefined falls back to the def"
  },
  "allowedHttpHookUrls": {
    "type": "array",
    "description": "Allowlist of URL patterns that HTTP hooks may target. Supports * as a wildcard. When set, hooks with non-matching URLs are blocked. Undefined = no restriction, empty array = block all HTTP hooks. Arrays merge across settings sources"
  },
  "allowManagedHooksOnly": {
    "type": "boolean",
    "description": "(Managed settings only) Prevent loading of user, project, and plugin hooks. Only allows managed hooks and SDK hooks"
  },
  "allowManagedPermissionRulesOnly": {
    "type": "boolean",
    "description": "(Managed settings only) Prevent user and project settings from defining allow, ask, or deny permission rules. Only rules in managed settings apply"
  },
  "statusLine": {
    "type": "object",
    "description": "Custom status line display configuration"
  },
  "fileSuggestion": {
    "type": "object",
    "description": "Configure a custom script for @ file autocomplete"
  },
  "enabledPlugins": {
    "type": "object",
    "description": "Enabled plugins using plugin-id@marketplace-id format. Example: { \"formatter@anthropic-tools\": true }"
  },
  "extraKnownMarketplaces": {
    "type": "object",
    "description": "Additional marketplaces to make available for this repository. Typically used in repository .claude/settings.json to ensure team members have required plugin sources"
  },
  "strictKnownMarketplaces": {
    "type": "array",
    "description": "(Managed settings only) Allowlist of plugin marketplaces users can add. Undefined = no restrictions, empty array = lockdown. Uses exact matching for source specifications"
  },
  "skippedMarketplaces": {
    "type": "array",
    "description": "List of marketplace names the user has chosen not to install when prompted"
  },
  "skippedPlugins": {
    "type": "array",
    "description": "List of plugin IDs (plugin@marketplace format) the user has chosen not to install when prompted"
  },
  "forceLoginMethod": {
    "type": "string",
    "description": "Use \"claudeai\" to restrict login to Claude.ai accounts, \"console\" to restrict login to Claude Console accounts, or \"gateway\" to restrict login to a cloud gateway. On Claude Code v2.1.212 or later, every first-party login path enforces the restriction, including the VS Code extension, the Agent SDK, "
  },
  "forceLoginOrgUUID": {
    "type": null,
    "description": "Organization UUID to use for OAuth login, or an array of UUIDs to allow several organizations. An empty array fails closed and blocks every login"
  },
  "otelHeadersHelper": {
    "type": "string",
    "description": "Path to an executable, or a shell command line with arguments, that outputs OpenTelemetry headers as a JSON object. Runs at startup and re-runs on the interval set by CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS. Requires CLAUDE_CODE_ENABLE_TELEMETRY=1"
  },
  "outputStyle": {
    "type": "string",
    "description": "Controls the output style for assistant responses. Built-in styles: default, Proactive, Explanatory, Learning. Custom styles can be added in ~/.claude/output-styles/ or .claude/output-styles/"
  },
  "skipWebFetchPreflight": {
    "type": "boolean",
    "description": "Skip the WebFetch blocklist check for enterprise environments with restrictive security policies"
  },
  "sandbox": {
    "type": "object",
    "description": "Sandbox execution configuration"
  },
  "spinnerVerbs": {
    "type": "object",
    "description": "Customize the verbs shown in spinner progress messages"
  },
  "spinnerTipsEnabled": {
    "type": "boolean",
    "description": "Show tips in the spinner while Claude is working. Set to false to disable tips (default: true)"
  },
  "spinnerTipsOverride": {
    "type": "object",
    "description": "Customize the tips displayed in the spinner while Claude is working"
  },
  "terminalProgressBarEnabled": {
    "type": "boolean",
    "description": "Enable the terminal progress bar that shows progress in supported terminals like Windows Terminal and iTerm2 (default: true)"
  },
  "showTurnDuration": {
    "type": "boolean",
    "description": "Show turn duration messages after responses (e.g., \"Cooked for 1m 6s\"). Set to false to hide these messages (default: true)"
  },
  "skillOverrides": {
    "type": "object",
    "description": "Per-skill visibility overrides. Controls whether skills appear to Claude and in the / picker. Values: 'on' (name and description shown, default), 'name-only' (name only), 'user-invocable-only' (hidden from Claude, visible in /), 'off' (hidden everywhere). Plugin skills are not affected by this setti"
  },
  "prefersReducedMotion": {
    "type": "boolean",
    "description": "Reduce or disable UI animations (spinners, shimmer, flash effects) for accessibility"
  },
  "prUrlTemplate": {
    "type": "string",
    "description": "URL template for the PR badge shown in the footer and in tool-result summaries. Substitutes placeholders {host}, {owner}, {repo}, {number}, {url} from the gh-reported PR URL. Use this to point PR links at an internal code-review tool instead of github.com. Does not affect #123 autolinks in Claude's "
  },
  "alwaysThinkingEnabled": {
    "type": "boolean",
    "description": "Enable extended thinking by default for all sessions. Typically configured via the /config command rather than editing directly"
  },
  "companyAnnouncements": {
    "type": "array",
    "description": "Company announcements to display at startup (one will be randomly selected if multiple are provided)"
  },
  "teammateMode": {
    "type": "string",
    "description": "How agent team teammates display: \"auto\" picks split panes in tmux or iTerm2, in-process otherwise; \"iterm2\" (added in v2.1.186) forces iTerm2 native split panes and requires the it2 CLI (it shows an error with the install command if it2 is missing). The default is \"in-process\" (it was \"auto\" before"
  },
  "worktree": {
    "type": "object",
    "description": "Configuration for --worktree sessions"
  },
  "parentSettingsBehavior": {
    "type": "string",
    "description": "(Admin/managed settings only) Controls how SDK managedSettings (parent tier) merge with inherited settings. 'first-wins': first non-empty value applies (default). 'merge': merge arrays and objects"
  },
  "pluginTrustMessage": {
    "type": "string",
    "description": "(Managed settings only) Custom message appended to the plugin trust warning shown before installation. Use to provide organization-specific context about approved plugins"
  },
  "pluginConfigs": {
    "type": "object",
    "description": "Per-plugin configuration including MCP server user configs and plugin options, keyed by plugin ID (plugin@marketplace format)"
  },
  "allowManagedMcpServersOnly": {
    "type": "boolean",
    "description": "(Managed settings only) When true, only allowedMcpServers from managed settings are respected; MCP servers defined in user, project, or local settings are ignored. deniedMcpServers still merges from all sources"
  },
  "blockedMarketplaces": {
    "type": "array",
    "description": "(Managed settings only) Blocklist of marketplace sources. These exact sources are blocked from being added as marketplaces. The check happens before downloading, so blocked sources never touch the filesystem."
  },
  "agent": {
    "type": "string",
    "description": "Name of an agent (built-in or custom) to use for the main thread. Applies the agent's system prompt, tool restrictions, and model"
  },
  "autoMemoryDirectory": {
    "type": "string",
    "description": "Custom directory path for auto-memory storage. Supports ~/ prefix for home-directory expansion. Ignored if set in checked-in project settings (.claude/settings.json) for security. Defaults to ~/.claude/projects/<sanitized-cwd>/memory/ when unset"
  },
  "autoMode": {
    "type": "object",
    "description": "Customization for the auto mode classifier prompt. Typically configured in managed settings to tune the allow/deny rules used when permissions.defaultMode is \"auto\". By default, allow, soft_deny, and environment REPLACE the corresponding built-in classifier section entirely. Include the literal stri"
  },
  "channelsEnabled": {
    "type": "boolean",
    "description": "(Managed settings only) Allow channels for the organization. On claude.ai Team and Enterprise plans, channels are blocked when this is unset or false. For Anthropic Console accounts using API key authentication, channels are allowed by default unless the organization deploys managed settings, in whi"
  },
  "defaultShell": {
    "type": "string",
    "description": "Default shell for input-box ! commands. Default: bash. Using \"powershell\" routes ! commands through PowerShell on Windows and requires CLAUDE_CODE_USE_POWERSHELL_TOOL=1 with pwsh on PATH"
  },
  "disableDeepLinkRegistration": {
    "type": "string",
    "description": "Set to \"disable\" to prevent Claude Code from registering the `claude-cli://` deep-link protocol handler on startup. Most useful in managed settings where users cannot override it"
  },
  "disableSkillShellExecution": {
    "type": "boolean",
    "description": "Disable inline shell execution for `` !`...` `` and ` ```! ` blocks in skills and custom slash commands from user, project, plugin, or additional-directory sources. Commands are replaced with [shell command execution disabled by policy] instead of being run. Bundled and managed skills are not affect"
  },
  "forceRemoteSettingsRefresh": {
    "type": "boolean",
    "description": "(Managed settings only) Block CLI startup until remote managed settings are freshly fetched from the server. If the fetch fails, the CLI exits (fail-closed) rather than continuing with cached settings. When not set, startup continues without waiting for remote settings"
  },
  "minimumVersion": {
    "type": "string",
    "description": "Minimum Claude Code version to stay on. Prevents downgrades when switching release channels"
  },
  "showClearContextOnPlanAccept": {
    "type": "boolean",
    "description": "When true, the plan-approval dialog offers a \"clear context\" option. Defaults to false."
  },
  "showThinkingSummaries": {
    "type": "boolean",
    "description": "Show thinking summaries in the transcript view (Ctrl+O). Thinking summaries are not generated by default in interactive sessions; set to true to restore"
  },
  "skipDangerousModePermissionPrompt": {
    "type": "boolean",
    "description": "Whether the user has accepted the bypass permissions mode dialog. Typically managed by the CLI rather than set by hand."
  },
  "strictPluginOnlyCustomization": {
    "type": null,
    "description": "(Managed settings) Block non-plugin customization sources for the listed surfaces. Array form locks specific surfaces (e.g., [\"skills\", \"hooks\"]); true locks all four; false is an explicit no-op"
  },
  "tui": {
    "type": "string",
    "description": "TUI rendering mode. Use \"fullscreen\" for the flicker-free alt-screen renderer with virtualized scrollback; \"default\" for the classic main-screen renderer. Corresponds to the /tui command"
  },
  "viewMode": {
    "type": "string",
    "description": "Transcript view mode. \"default\" shows standard interactive view; \"verbose\" shows expanded tool details; \"focus\" shows prompt, one-line tool summaries, and final response only (Ctrl+O toggle)"
  },
  "useAutoModeDuringPlan": {
    "type": "boolean",
    "description": "When true, apply the auto mode classifier during plan mode to auto-approve safe read-only tool calls while planning. Has no effect unless permissions.defaultMode allows auto"
  },
  "voiceEnabled": {
    "type": "boolean",
    "description": "Legacy alias for voice.enabled; prefer the voice object. Requires a Claude.ai account"
  },
  "wslInheritsWindowsSettings": {
    "type": "boolean",
    "description": "(Windows managed settings only) When true, Claude Code on WSL reads managed settings from the Windows policy chain in addition to /etc/claude-code, with Windows sources taking priority. Only honored when set in the HKLM registry key or C:\\Program Files\\ClaudeCode\\managed-settings.json, both of which"
  },
  "subagentStatusLine": {
    "type": "object",
    "description": "Status line configuration for subagent sessions"
  },
  "advisorModel": {
    "type": "string",
    "description": "Model for the server-side advisor tool. Accepts a model alias (\"opus\", \"sonnet\", or \"fable\" on v2.1.170+) or a full model ID. Overridden by the --advisor CLI flag for the session, and blocked when the model is outside the availableModels allowlist"
  },
  "autoCompactEnabled": {
    "type": "boolean",
    "description": "Automatically compact the conversation when context approaches the limit. Also configurable via the DISABLE_AUTO_COMPACT environment variable"
  },
  "disableAgentView": {
    "type": "boolean",
    "description": "(Managed settings) Turn off background agents and the agent view: claude agents, --bg, /background, and the on-demand supervisor. Also configurable via the CLAUDE_CODE_DISABLE_AGENT_VIEW environment variable (set to 1 to disable)"
  },
  "editorMode": {
    "type": "string",
    "description": "Key binding mode for the input prompt: \"normal\" or \"vim\". Appears in /config as Editor mode"
  },
  "enforceAvailableModels": {
    "type": "boolean",
    "description": "(Managed settings) Extend the availableModels allowlist to the Default model option (requires v2.1.175+). Requires a non-empty availableModels list; when the account-type default is not in the allowlist, Default resolves to the first allowed entry instead. Has no effect when availableModels is unset"
  },
  "fallbackModel": {
    "type": "array",
    "description": "Fallback model chain tried in order when the primary model is overloaded, unavailable, or returns a non-retryable server error. Capped at three entries after deduplication; accepts model names or aliases, and \"default\" expands to the account-type default. Overridden by the --fallback-model CLI flag "
  },
  "fileCheckpointingEnabled": {
    "type": "boolean",
    "description": "Snapshot edited files so /rewind can restore them. Also configurable via the CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING environment variable (set to 1 to disable)"
  },
  "gcpAuthRefresh": {
    "type": "string",
    "description": "Command to run when GCP credentials are expired or cannot be loaded. The command's output is displayed to the user but interactive input is not supported; it times out after three minutes"
  },
  "managedMcpServers": {
    "type": "array",
    "description": "(Managed settings, third-party Desktop deployments only) MCP server configurations pushed to all users. Each entry specifies the transport and connection details, plus an optional toolPolicy map. Delivered through the managed settings file or MDM"
  },
  "skillListingMaxDescChars": {
    "type": "integer",
    "description": "Per-skill character cap on the combined description and when_to_use text in the skill listing Claude sees each turn. Text longer than this is truncated"
  },
  "preferredNotifChannel": {
    "type": "string",
    "description": "Method for task-complete and permission-prompt notifications. \"auto\" (default) sends a desktop notification in iTerm2, Ghostty, and Kitty and does nothing in other terminals; \"terminal_bell\" rings the bell in any terminal; \"notifications_disabled\" turns them off"
  },
  "pluginSuggestionMarketplaces": {
    "type": "array",
    "description": "(Managed settings only) Allowlist of marketplace names whose plugins may surface as contextual \"suggested for this directory\" tips in the /plugin Discover tab. No marketplace-declared suggestions surface without this allowlist. The built-in first-party frontend-design tip is unaffected"
  },
  "requiredMaximumVersion": {
    "type": "string",
    "description": "(Managed settings only) Maximum Claude Code version allowed to start. If the running version is newer, Claude Code exits at startup with instructions to install an approved version"
  },
  "requiredMinimumVersion": {
    "type": "string",
    "description": "(Managed settings only) Minimum Claude Code version required to start. If the running version is older, Claude Code exits at startup rather than only warning"
  },
  "respondToBashCommands": {
    "type": "boolean",
    "description": "Whether Claude responds after an input-box ! shell command runs (v2.1.186+). Set to false to add the command output to context without a response"
  },
  "skillListingBudgetFraction": {
    "type": "number",
    "description": "Fraction of the model context window reserved for the skill listing sent to Claude (default 0.01 = 1%). When the listing exceeds this, descriptions are shortened to fit. Also configurable via the SLASH_COMMAND_TOOL_CHAR_BUDGET environment variable (fixed character count)"
  },
  "sshConfigs": {
    "type": "array",
    "description": "(Managed settings) Pre-configured SSH connections distributed to Desktop users"
  },
  "sshHostAllowlist": {
    "type": "array",
    "description": "(Managed settings only) Allowlist restricting Desktop SSH sessions to approved hosts. Patterns are case-insensitive; * matches any host and *.example.com matches example.com and any subdomain"
  },
  "theme": {
    "type": null,
    "description": "Color theme for the interface: auto, dark, light, the daltonized variants (deuteranopia-friendly), the ansi variants (16-color terminals), or a custom theme reference such as custom:<slug> or custom:<plugin-name>:<slug>"
  },
  "voice": {
    "type": "object",
    "description": "Voice dictation settings: enabled turns dictation on, mode selects \"hold\" or \"tap\", and autoSubmit sends the prompt on key release in hold mode. Written automatically when you run /voice. Requires a Claude.ai account"
  },
  "wheelScrollAccelerationEnabled": {
    "type": "boolean",
    "description": "In fullscreen rendering, accelerate mouse-wheel scroll speed during fast scrolls (v2.1.174+). Set to false for a constant scroll rate per wheel notch"
  },
  "disableBundledSkills": {
    "type": "boolean",
    "description": "Disable the skills and workflows that ship with Claude Code: bundled skills and workflows are removed entirely, while built-in slash commands like /init stay typable but are hidden from the model. Skills from plugins, .claude/skills/, and .claude/commands/ are unaffected. Also configurable via the C"
  },
  "awaySummaryEnabled": {
    "type": "boolean",
    "description": "Show a one-line session recap when you return to the terminal after a few minutes away. Set to false (or turn off Session recap in /config) to disable"
  },
  "autoScrollEnabled": {
    "type": "boolean",
    "description": "In fullscreen rendering, follow new output to the bottom of the conversation. Appears in /config as Auto-scroll. Permission prompts still scroll into view when this is off"
  },
  "allowAllClaudeAiMcps": {
    "type": "boolean",
    "description": "(Managed settings only) Load claude.ai connectors alongside a deployed managed-mcp.json, which otherwise takes exclusive control and suppresses them"
  },
  "agentPushNotifEnabled": {
    "type": "boolean",
    "description": "When Remote Control is connected, allow Claude to send proactive push notifications to your phone, for example when a long task finishes. Requires Claude Code v2.1.119 or later"
  },
  "axScreenReader": {
    "type": "boolean",
    "description": "Render screen-reader-friendly output: flat text without decorative borders or animations screen-reader mode always uses the classic renderer, so the tui setting has no effect while it is active. The CLAUDE_AX_SCREEN_READER environment variable and --ax-screen-reader flag take precedence. Requires Cl"
  },
  "claudeMd": {
    "type": "string",
    "description": "(Managed settings only) CLAUDE.md-style instructions injected as organization-managed memory. Honored only from managed/policy settings"
  },
  "disableArtifact": {
    "type": "boolean",
    "description": "Disable the Artifact tool, which publishes session output as a private web page on claude.ai. Also configurable via the CLAUDE_CODE_DISABLE_ARTIFACT environment variable"
  },
  "disableAutoMode": {
    "type": "string",
    "description": "Set to \"disable\" to prevent auto mode from being activated: removes auto from the Shift+Tab cycle and rejects --permission-mode auto at startup"
  },
  "disableClaudeAiConnectors": {
    "type": "boolean",
    "description": "Disable claude.ai MCP connectors so they are not auto-fetched or connected. A value of true in any settings source takes precedence. Requires Claude Code v2.1.182 or later"
  },
  "disableRemoteControl": {
    "type": "boolean",
    "description": "Disable Remote Control: blocks claude remote-control, the --remote-control flag, auto-start, and the in-session toggle. Requires Claude Code v2.1.128 or later"
  },
  "disableWorkflows": {
    "type": "boolean",
    "description": "Disable dynamic workflows and bundled workflow commands. Also configurable via the CLAUDE_CODE_DISABLE_WORKFLOWS environment variable"
  },
  "footerLinksRegexes": {
    "type": "array",
    "description": "Render extra clickable badges in the footer when a regex matches turn output (tool results and assistant responses). Read from user, --settings flag, and managed settings only; ignored in project and local settings. Requires Claude Code v2.1.176 or later"
  },
  "inputNeededNotifEnabled": {
    "type": "boolean",
    "description": "When Remote Control is connected, send a push notification to your phone when a permission prompt or question is waiting for input. Requires Claude Code v2.1.119 or later"
  },
  "policyHelper": {
    "type": "object",
    "description": "Admin-deployed executable that computes managed settings dynamically at startup. Honored only from MDM or the system managed-settings.json. Requires Claude Code v2.1.136 or later"
  },
  "remoteControlAtStartup": {
    "type": "boolean",
    "description": "Connect Remote Control automatically when each interactive session starts. true = always, false = never, unset = organization default. Requires Claude Code v2.1.119 or later"
  },
  "syntaxHighlightingDisabled": {
    "type": "boolean",
    "description": "Disable syntax highlighting in diffs, code blocks, and file previews"
  },
  "verbose": {
    "type": "boolean",
    "description": "Show full tool output instead of truncated summaries. The --verbose flag overrides this for a single session. Requires Claude Code v2.1.119 or later"
  },
  "workflowKeywordTriggerEnabled": {
    "type": "boolean",
    "description": "Whether including the keyword \"ultracode\" in a prompt triggers a dynamic workflow. Requires Claude Code v2.1.157 or later"
  },
  "askUserQuestionTimeout": {
    "type": "string",
    "description": "Idle time before an unanswered AskUserQuestion dialog auto-continues with whatever options you had already selected. Accepts \"60s\", \"5m\", \"10m\", or \"never\" (default: \"never\", which waits until you answer). Appears in /config as Question auto-continue timeout, which writes this key to user settings. "
  },
  "teammateDefaultModel": {
    "type": null,
    "description": "Default model for agent team teammates when the spawn prompt does not specify one. Set to a model alias such as \"sonnet\", or null to inherit the lead's current /model selection. Appears in /config as Default teammate model"
  },
  "workflowSizeGuideline": {
    "type": "string",
    "description": "Sets the agent count Claude aims for in the dynamic workflows it writes. Claude Code sends the value to Claude as advice, not an enforced cap. Accepts \"unrestricted\" (default, which sends no guideline), \"small\", \"medium\", or \"large\". Appears in /config as Dynamic workflow size, and can be set with /"
  },
  "enableArtifact": {
    "type": "boolean",
    "description": "Enable or disable the Artifact tool for this user. When unset, the default follows the feature's availability for your account. The Artifacts row in /config writes this key. A managed disableArtifact and your organization's admin setting take precedence, and the key is ignored in project and local s"
  },
  "permissionExplainerEnabled": {
    "type": "boolean",
    "description": "Show a model-generated explanation of the command when you press Ctrl+E on a Bash or PowerShell permission prompt (default: true). Set to false to turn the shortcut off"
  },
  "diffTool": {
    "type": "string",
    "description": "Where to display file diffs when an IDE is connected: \"auto\" (default) opens diffs in the IDE's diff viewer, \"terminal\" keeps them in the terminal. Appears in /config as Diff tool only when Claude Code is connected to a VS Code or JetBrains IDE"
  },
  "externalEditorContext": {
    "type": "boolean",
    "description": "Prepend Claude's previous response as #-commented context when you open the external editor with Ctrl+G (default: false). Appears in /config as Show last response in external editor"
  },
  "autoConnectIde": {
    "type": "boolean",
    "description": "Automatically connect to a running IDE when Claude Code starts from an external terminal (default: false). Appears in /config as Auto-connect to IDE (external terminal) when running outside a VS Code or JetBrains terminal. Also configurable via the CLAUDE_CODE_AUTO_CONNECT_IDE environment variable, "
  },
  "autoInstallIdeExtension": {
    "type": "boolean",
    "description": "Automatically install the Claude Code IDE extension when running from a VS Code terminal (default: true). Appears in /config as Auto-install IDE extension when running inside a VS Code or JetBrains terminal. You can also set the CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL environment variable to 1"
  },
  "emojiCompletionEnabled": {
    "type": "boolean",
    "description": "Show emoji suggestions when you type : plus a shortcode in the prompt input, and replace a completed shortcode such as :heart: with its emoji (default: true). Set to false to disable both. Requires Claude Code v2.1.217 or later"
  },
  "vimInsertModeRemaps": {
    "type": "object",
    "description": "Map two-key INSERT-mode sequences to Escape in vim editor mode. Each key is exactly two printable characters typed in sequence, and \"<Esc>\" is the only supported target; other entries are ignored. Read from user, --settings flag, and managed settings only, so a repository's checked-in settings canno"
  },
  "processWrapper": {
    "type": "string",
    "description": "Corporate launcher command placed in front of the background processes Claude Code starts. Honored from managed settings, a --settings file, and user settings only; the CLAUDE_CODE_PROCESS_WRAPPER environment variable takes precedence when both are set. Requires Claude Code v2.1.210 or later"
  },
  "forceLoginGatewayUrl": {
    "type": "string",
    "description": "Pre-fills and locks the gateway URL on the /login Cloud gateway screen. Either this key or forceLoginMethod: \"gateway\" surfaces that screen; set both so the URL is filled in. Honored only at the managed policy tier; ignored in user and project settings"
  },
  "disableSideloadFlags": {
    "type": "boolean",
    "description": "(Managed settings only) Reject the --plugin-dir, --plugin-url, --agents, and --mcp-config CLI flags at startup, which users could otherwise pass to bypass strictKnownMarketplaces for a single run. Also rejects these flags from any surface that spawns the CLI with them internally, currently Cowork lo"
  },
  "browserExternalPageTools": {
    "type": "string",
    "description": "(Managed settings only) Set to \"disabled\" to prevent Claude from using tools to read or act on external pages in the desktop app's Browser pane. Users can still navigate to external sites themselves, and local dev server previews are unaffected"
  },
  "disableBrowserExternalNavigation": {
    "type": "boolean",
    "description": "(Managed settings only) Set to true to turn off external browsing in the desktop app's Browser pane. Neither users nor Claude can navigate to external sites, and localhost dev server previews are unaffected. The value must be the JSON boolean true; the string \"true\" is ignored"
  },
  "disableMobileSimulatorTools": {
    "type": "boolean",
    "description": "(Managed settings only) Set to true to block Claude's tools for the desktop app's iOS Simulator pane. Users keep manual use of the pane; only Claude's access is removed. The value must be the JSON boolean true; any other value is ignored, and a malformed value such as \"true\" or 1 logs a warning"
  },
  "requireCoworkFullVmSandbox": {
    "type": "boolean",
    "description": "(Managed settings only) Run Claude's tools inside an isolated virtual machine instead of on your Mac. Disables the desktop app's iOS Simulator pane and Claude's simulator tools entirely, so the pane cannot attach a device while it is set"
  }
};

export const PERMISSIONS_KEYS: Record<string, SchemaKeyInfo> = {
  "allow": {
    "type": "array",
    "description": "List of permission rules for allowed operations"
  },
  "deny": {
    "type": "array",
    "description": "List of permission rules for denied operations"
  },
  "ask": {
    "type": "array",
    "description": "List of permission rules that should always prompt for confirmation"
  },
  "defaultMode": {
    "type": "string",
    "description": "Default permission mode.\n\"default\": prompts on first use.\nUNDOCUMENTED. \"manual\": accepted alias for \"default\" (the CLI/VS Code/JetBrains UI now labels this mode \"Manual\" as of v2.1.200; permission-modes.md has not yet been updated to mention it).\n\"acceptEdits\": auto-accepts file edits.\n\"plan\": read"
  },
  "disableBypassPermissionsMode": {
    "type": "string",
    "description": "Disable the ability to bypass permission prompts"
  },
  "disableAutoMode": {
    "type": "string",
    "description": "Set to \"disable\" to prevent auto mode from being activated. Removes `auto` from the Shift+Tab cycle and rejects `--permission-mode auto` at startup. Most useful in managed settings where users cannot override it. See https://code.claude.com/docs/en/permissions"
  },
  "additionalDirectories": {
    "type": "array",
    "description": "Additional directories to include in the permission scope"
  }
};

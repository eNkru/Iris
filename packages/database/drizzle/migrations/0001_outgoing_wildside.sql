ALTER TABLE `global_settings` ADD `aiZenHost` text DEFAULT 'opencode.ai' NOT NULL;--> statement-breakpoint
ALTER TABLE `global_settings` ADD `aiUserAgent` text DEFAULT 'opencode/1.18.12 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.13' NOT NULL;--> statement-breakpoint
ALTER TABLE `global_settings` ADD `aiClientHeader` text DEFAULT 'cli' NOT NULL;
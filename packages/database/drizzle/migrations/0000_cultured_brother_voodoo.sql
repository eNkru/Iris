CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer NOT NULL,
	`image` text,
	`role` text DEFAULT 'user' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE TABLE `alert_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`channelType` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "alert_channels_channel_type_check" CHECK("alert_channels"."channelType" IN ('telegram', 'email'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alert_channels_user_id_channel_type_uq` ON `alert_channels` (`userId`,`channelType`);--> statement-breakpoint
CREATE INDEX `alert_channels_user_id_idx` ON `alert_channels` (`userId`);--> statement-breakpoint
CREATE TABLE `global_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`aiBaseUrl` text DEFAULT 'https://api.openai.com/v1' NOT NULL,
	`aiApiKey` text DEFAULT '' NOT NULL,
	`aiModel` text DEFAULT 'gpt-4o-mini' NOT NULL,
	`pollIntervalDefaultMinutes` integer DEFAULT 60 NOT NULL,
	`telegramBotToken` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`productId` text NOT NULL,
	`price` text NOT NULL,
	`currency` text,
	`checkedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `price_readings_product_id_checked_at_idx` ON `price_readings` (`productId`,`checkedAt`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`url` text NOT NULL,
	`name` text,
	`currency` text,
	`currentPrice` text,
	`lastCheckedAt` integer,
	`pollIntervalMinutes` integer,
	`alertRules` text,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `products_user_id_idx` ON `products` (`userId`);--> statement-breakpoint
CREATE INDEX `products_last_checked_at_idx` ON `products` (`lastCheckedAt`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`userId` text PRIMARY KEY NOT NULL,
	`aiModelOverride` text,
	`pollIntervalDefaultMinutes` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

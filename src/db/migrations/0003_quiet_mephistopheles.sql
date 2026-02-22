CREATE TABLE `device_blacklist` (
	`device_id` text PRIMARY KEY NOT NULL,
	`reason` text,
	`blocked_at` integer NOT NULL
);

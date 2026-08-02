/**
 * Shared query helper types.
 */

import type { AiProvider } from "@iris/utils";

export type GlobalSettingsRow = {
  id: number;
  aiProvider: AiProvider;
  aiModel: string;
  pollIntervalDefaultMinutes: number;
  telegramBotToken: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GlobalSettingsInput = {
  aiProvider?: AiProvider;
  aiModel?: string;
  pollIntervalDefaultMinutes?: number;
  telegramBotToken?: string;
};

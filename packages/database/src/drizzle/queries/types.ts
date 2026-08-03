/**
 * Shared query helper types.
 */

export type GlobalSettingsRow = {
  id: number;
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  pollIntervalDefaultMinutes: number;
  telegramBotToken: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GlobalSettingsInput = {
  aiBaseUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
  pollIntervalDefaultMinutes?: number;
  telegramBotToken?: string;
};

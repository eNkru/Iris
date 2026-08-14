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
  aiZenHost: string;
  aiUserAgent: string;
  aiClientHeader: string;
  createdAt: Date;
  updatedAt: Date;
};

export type GlobalSettingsInput = {
  aiBaseUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
  pollIntervalDefaultMinutes?: number;
  telegramBotToken?: string;
  aiZenHost?: string;
  aiUserAgent?: string;
  aiClientHeader?: string;
};

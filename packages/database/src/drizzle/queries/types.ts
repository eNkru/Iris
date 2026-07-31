/**
 * Shared query helper types.
 */

export type GlobalSettingsRow = {
  id: number;
  aiProvider: "openai" | "gemini" | "anthropic";
  aiModel: string;
  pollIntervalDefaultMinutes: number;
  telegramBotToken: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GlobalSettingsInput = {
  aiProvider?: "openai" | "gemini" | "anthropic";
  aiModel?: string;
  pollIntervalDefaultMinutes?: number;
  telegramBotToken?: string;
};

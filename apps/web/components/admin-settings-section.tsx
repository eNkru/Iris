"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useGlobalSettings, useUpdateGlobalSettings } from "../hooks/use-settings";
import { useI18n } from "../lib/i18n";
import { Button, ErrorBox, Input, Label, Spinner } from "./ui";

/**
 * Instance-level global settings (R6/R7, admin only): generic OpenAI-compatible
 * AI config (base URL + API key + model) + default poll interval + Telegram bot
 * token. The AI API key and the bot token are write-only (masked on read);
 * submitting an empty value leaves the stored secret unchanged.
 */
export function AdminSettingsSection() {
  const { t } = useI18n();
  const { data, isLoading, isError, error } = useGlobalSettings();
  const updateGlobalSettings = useUpdateGlobalSettings();

  const [aiBaseUrl, setAiBaseUrl] = useState("https://api.openai.com/v1");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [pollInterval, setPollInterval] = useState("");
  const [botToken, setBotToken] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Transient "Saved." feedback (R8): clears after ~3s.
  useEffect(() => {
    if (savedAt === null) {
      return;
    }
    const timer = setTimeout(() => setSavedAt(null), 3000);
    return () => clearTimeout(timer);
  }, [savedAt]);

  useEffect(() => {
    if (data && !hasLoaded) {
      setAiBaseUrl(data.settings.aiBaseUrl);
      setAiModel(data.settings.aiModel);
      setPollInterval(data.settings.pollIntervalDefaultMinutes.toString());
      setAiApiKey("");
      setBotToken("");
      setHasLoaded(true);
    }
  }, [data, hasLoaded]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    setSavedAt(null);

    const parsedInterval = Number(pollInterval);
    if (!Number.isInteger(parsedInterval) || parsedInterval < 1) {
      setErrorMessage(t("adminSettings.intervalInvalid"));
      return;
    }

    try {
      new URL(aiBaseUrl);
    } catch {
      setErrorMessage(t("adminSettings.aiBaseUrlInvalid"));
      return;
    }

    try {
      await updateGlobalSettings.mutateAsync({
        aiBaseUrl,
        aiModel,
        pollIntervalDefaultMinutes: parsedInterval,
        aiApiKey: aiApiKey.trim() === "" ? undefined : aiApiKey.trim(),
        telegramBotToken: botToken.trim() === "" ? undefined : botToken.trim(),
      });
      setAiApiKey("");
      setBotToken("");
      setSavedAt(Date.now());
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : t("adminSettings.saveError"),
      );
    }
  };

  return (
    <div className="space-y-4">
      {isLoading ? <Spinner label={t("adminSettings.loading")} /> : null}
      {isError ? (
        <ErrorBox
          message={
            error instanceof Error ? error.message : t("adminSettings.loadError")
          }
        />
      ) : null}
      {!isLoading && !isError ? (
        <form onSubmit={onSubmit} className="max-w-md space-y-3">
          <div>
            <Label htmlFor="ai-base-url">{t("adminSettings.aiBaseUrlLabel")}</Label>
            <Input
              id="ai-base-url"
              type="url"
              required
              placeholder={t("adminSettings.aiBaseUrlPlaceholder")}
              value={aiBaseUrl}
              onChange={(e) => {
                setSavedAt(null);
                setAiBaseUrl(e.target.value);
              }}
              disabled={updateGlobalSettings.isPending}
            />
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {t("adminSettings.aiBaseUrlHint")}
            </p>
          </div>

          <div>
            <Label htmlFor="ai-api-key">{t("adminSettings.aiApiKeyLabel")}</Label>
            <Input
              id="ai-api-key"
              type="password"
              autoComplete="off"
              placeholder={t("adminSettings.aiApiKeyPlaceholder")}
              value={aiApiKey}
              onChange={(e) => {
                setSavedAt(null);
                setAiApiKey(e.target.value);
              }}
              disabled={updateGlobalSettings.isPending}
            />
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {data?.settings.aiApiKey
                ? t("adminSettings.aiApiKeyStored", { key: data.settings.aiApiKey })
                : t("adminSettings.aiApiKeyNone")}
            </p>
          </div>

          <div>
            <Label htmlFor="ai-model">{t("adminSettings.aiModelLabel")}</Label>
            <Input
              id="ai-model"
              type="text"
              required
              placeholder={t("adminSettings.aiModelPlaceholder")}
              value={aiModel}
              onChange={(e) => {
                setSavedAt(null);
                setAiModel(e.target.value);
              }}
              disabled={updateGlobalSettings.isPending}
            />
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {t("adminSettings.aiModelHint")}
            </p>
          </div>

          <div>
            <Label htmlFor="global-interval">
              {t("adminSettings.intervalLabel")}
            </Label>
            <Input
              id="global-interval"
              type="number"
              min="1"
              step="1"
              required
              value={pollInterval}
              onChange={(e) => {
                setSavedAt(null);
                setPollInterval(e.target.value);
              }}
              disabled={updateGlobalSettings.isPending}
            />
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {t("adminSettings.intervalHint")}
            </p>
          </div>

          <div>
            <Label htmlFor="bot-token">{t("adminSettings.botTokenLabel")}</Label>
            <Input
              id="bot-token"
              type="password"
              autoComplete="off"
              placeholder={t("adminSettings.botTokenPlaceholder")}
              value={botToken}
              onChange={(e) => {
                setSavedAt(null);
                setBotToken(e.target.value);
              }}
              disabled={updateGlobalSettings.isPending}
            />
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {data?.settings.telegramBotToken
                ? t("adminSettings.botTokenStored", {
                    token: data.settings.telegramBotToken,
                  })
                : t("adminSettings.botTokenNone")}
            </p>
          </div>

          {errorMessage ? <ErrorBox message={errorMessage} /> : null}
          {savedAt !== null ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              {t("adminSettings.saved")}
            </p>
          ) : null}
          <Button type="submit" disabled={updateGlobalSettings.isPending}>
            {updateGlobalSettings.isPending ? (
              <Spinner label={t("adminSettings.saving")} />
            ) : (
              t("adminSettings.submit")
            )}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
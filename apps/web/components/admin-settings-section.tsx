"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AI_PROVIDER_VALUES, type AiProvider } from "@iris/utils/enum-types";
import { useGlobalSettings, useUpdateGlobalSettings } from "../hooks/use-settings";
import { Button, ErrorBox, Input, Label, Spinner } from "./ui";

/**
 * Instance-level global settings (R6/R7, admin only): AI provider + model +
 * default poll interval + Telegram bot token (write-only, masked on read).
 */
export function AdminSettingsSection() {
  const { data, isLoading, isError, error } = useGlobalSettings();
  const updateGlobalSettings = useUpdateGlobalSettings();

  const [aiProvider, setAiProvider] = useState<AiProvider>("openai");
  const [aiModel, setAiModel] = useState("");
  const [pollInterval, setPollInterval] = useState("");
  const [botToken, setBotToken] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (data && !hasLoaded) {
      setAiProvider(data.settings.aiProvider);
      setAiModel(data.settings.aiModel);
      setPollInterval(data.settings.pollIntervalDefaultMinutes.toString());
      setBotToken("");
      setHasLoaded(true);
    }
  }, [data, hasLoaded]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);

    const parsedInterval = Number(pollInterval);
    if (!Number.isInteger(parsedInterval) || parsedInterval < 1) {
      setErrorMessage("Poll interval must be a whole number of minutes.");
      return;
    }

    try {
      await updateGlobalSettings.mutateAsync({
        aiProvider,
        aiModel,
        pollIntervalDefaultMinutes: parsedInterval,
        telegramBotToken: botToken.trim() === "" ? undefined : botToken.trim(),
      });
      setBotToken("");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save global settings.");
    }
  };

  return (
    <div className="space-y-4">
      {isLoading ? <Spinner label="Loading global settings…" /> : null}
      {isError ? (
        <ErrorBox
          message={
            error instanceof Error ? error.message : "Failed to load global settings."
          }
        />
      ) : null}
      {!isLoading && !isError ? (
        <form onSubmit={onSubmit} className="max-w-md space-y-3">
          <div>
            <Label htmlFor="ai-provider">AI provider</Label>
            <select
              id="ai-provider"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              value={aiProvider}
              onChange={(e) => setAiProvider(e.target.value as AiProvider)}
              disabled={updateGlobalSettings.isPending}
            >
              {AI_PROVIDER_VALUES.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="ai-model">AI model</Label>
            <Input
              id="ai-model"
              type="text"
              required
              placeholder="e.g. gpt-4o-mini, gemini-1.5-flash, claude-3-5-haiku"
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              disabled={updateGlobalSettings.isPending}
            />
          </div>

          <div>
            <Label htmlFor="global-interval">Default poll interval (minutes)</Label>
            <Input
              id="global-interval"
              type="number"
              min="1"
              step="1"
              required
              value={pollInterval}
              onChange={(e) => setPollInterval(e.target.value)}
              disabled={updateGlobalSettings.isPending}
            />
            <p className="mt-1 text-xs text-slate-400">
              Instance default; users and products can override it.
            </p>
          </div>

          <div>
            <Label htmlFor="bot-token">Telegram bot token</Label>
            <Input
              id="bot-token"
              type="password"
              autoComplete="off"
              placeholder="Leave empty to keep the stored token"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              disabled={updateGlobalSettings.isPending}
            />
            <p className="mt-1 text-xs text-slate-400">
              {data?.settings.telegramBotToken
                ? `Stored token: ${data.settings.telegramBotToken}`
                : "No token stored."}
            </p>
          </div>

          {errorMessage ? <ErrorBox message={errorMessage} /> : null}
          {updateGlobalSettings.isSuccess ? (
            <p className="text-sm text-emerald-700">Saved.</p>
          ) : null}
          <Button type="submit" disabled={updateGlobalSettings.isPending}>
            {updateGlobalSettings.isPending ? <Spinner label="Saving…" /> : "Save global settings"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

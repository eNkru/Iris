"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useGlobalSettings, useUpdateGlobalSettings } from "../hooks/use-settings";
import { Button, ErrorBox, Input, Label, Spinner } from "./ui";

/**
 * Instance-level global settings (R6/R7, admin only): generic OpenAI-compatible
 * AI config (base URL + API key + model) + default poll interval + Telegram bot
 * token. The AI API key and the bot token are write-only (masked on read);
 * submitting an empty value leaves the stored secret unchanged.
 */
export function AdminSettingsSection() {
  const { data, isLoading, isError, error } = useGlobalSettings();
  const updateGlobalSettings = useUpdateGlobalSettings();

  const [aiBaseUrl, setAiBaseUrl] = useState("https://api.openai.com/v1");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [pollInterval, setPollInterval] = useState("");
  const [botToken, setBotToken] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

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

    const parsedInterval = Number(pollInterval);
    if (!Number.isInteger(parsedInterval) || parsedInterval < 1) {
      setErrorMessage("Poll interval must be a whole number of minutes.");
      return;
    }

    try {
      new URL(aiBaseUrl);
    } catch {
      setErrorMessage("AI base URL must be a valid URL (e.g. https://api.openai.com/v1).");
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
            <Label htmlFor="ai-base-url">AI base URL</Label>
            <Input
              id="ai-base-url"
              type="url"
              required
              placeholder="https://api.openai.com/v1"
              value={aiBaseUrl}
              onChange={(e) => setAiBaseUrl(e.target.value)}
              disabled={updateGlobalSettings.isPending}
            />
            <p className="mt-1 text-xs text-slate-400">
              Any OpenAI-compatible endpoint (OpenAI, OpenRouter, OpenCode Zen,
              a local Llama/Ollama server, etc.).
            </p>
          </div>

          <div>
            <Label htmlFor="ai-api-key">AI API key</Label>
            <Input
              id="ai-api-key"
              type="password"
              autoComplete="off"
              placeholder="Leave empty to keep the stored key"
              value={aiApiKey}
              onChange={(e) => setAiApiKey(e.target.value)}
              disabled={updateGlobalSettings.isPending}
            />
            <p className="mt-1 text-xs text-slate-400">
              {data?.settings.aiApiKey
                ? `Stored key: ${data.settings.aiApiKey}`
                : "No key stored."}
            </p>
          </div>

          <div>
            <Label htmlFor="ai-model">AI model</Label>
            <Input
              id="ai-model"
              type="text"
              required
              placeholder="e.g. gpt-4o-mini, deepseek-v4-flash-free, llama3.1"
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              disabled={updateGlobalSettings.isPending}
            />
            <p className="mt-1 text-xs text-slate-400">
              Must support tool calling (the model fetches the product page itself).
            </p>
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

"use client";

import { useState, type FormEvent } from "react";
import { useI18n } from "../lib/i18n";
import {
  useChannels,
  useCreateChannel,
  useDeleteChannel,
  useUpdateChannel,
} from "../hooks/use-channels";
import {
  Button,
  ButtonDanger,
  ButtonSecondary,
  ErrorBox,
  Input,
  Label,
  SegmentedControl,
  Spinner,
} from "./ui";

/**
 * Alert channel management (R11/R12). MVP supports one Telegram channel per
 * user; chat id + notification message language are the configurable fields.
 */

/** Notification language options for the add-form / per-row selector. */
const LANGUAGE_OPTIONS = [
  { value: "en", label: "EN" },
  { value: "zh", label: "中文" },
] as const;

export function ChannelsSection() {
  const { t } = useI18n();
  const { data, isLoading, isError, error } = useChannels();
  const createChannel = useCreateChannel();
  const updateChannel = useUpdateChannel();
  const deleteChannel = useDeleteChannel();

  const [chatId, setChatId] = useState("");
  const [language, setLanguage] = useState<"en" | "zh">("en");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const channels = data?.channels ?? [];

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);

    if (!/^\d+$/.test(chatId.trim())) {
      setErrorMessage(t("channels.chatIdInvalid"));
      return;
    }

    try {
      await createChannel.mutateAsync({
        channelType: "telegram",
        chatId: chatId.trim(),
        language,
      });
      setChatId("");
      setLanguage("en");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t("channels.addError"));
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setErrorMessage(null);
    try {
      await deleteChannel.mutateAsync(id);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t("channels.deleteError"));
    } finally {
      setDeletingId(null);
    }
  };

  // Each channel's message language; a missing/invalid config value defaults to English.
  const channelLanguage = (channel: (typeof channels)[number]): "en" | "zh" => {
    const raw = (channel.config as Record<string, unknown> | null)?.language;
    return raw === "zh" ? "zh" : "en";
  };

  return (
    <div className="space-y-4">
      {isLoading ? <Spinner label={t("channels.loading")} /> : null}
      {isError ? (
        <ErrorBox message={error instanceof Error ? error.message : t("channels.loadError")} />
      ) : null}

      {channels.length > 0 ? (
        <div className="space-y-2">
          {channels.map((channel) => {
            const lang = channelLanguage(channel);
            return (
              <div
                key={channel.id}
                className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {t("channels.rowTitle", { id: String(channel.config.chatId ?? "?") })}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {channel.enabled ? t("channels.enabled") : t("channels.disabled")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <SegmentedControl
                    label={t("channels.languageLabel")}
                    options={LANGUAGE_OPTIONS}
                    value={lang}
                    onChange={(next) =>
                      updateChannel.mutate(
                        { id: channel.id, language: next },
                        { onError: (err) => setErrorMessage(err.message) },
                      )
                    }
                  />
                  <ButtonSecondary
                    onClick={() =>
                      updateChannel.mutate(
                        { id: channel.id, enabled: !channel.enabled },
                        { onError: (err) => setErrorMessage(err.message) },
                      )
                    }
                    disabled={updateChannel.isPending}
                  >
                    {channel.enabled ? t("channels.disable") : t("channels.enable")}
                  </ButtonSecondary>
                  <ButtonDanger
                    onClick={() => handleDelete(channel.id)}
                    disabled={deletingId === channel.id || deleteChannel.isPending}
                  >
                    {deletingId === channel.id ? t("channels.deleting") : t("channels.delete")}
                  </ButtonDanger>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("channels.empty")}</p>
      )}

      <form onSubmit={onSubmit} className="max-w-md space-y-3">
        <div>
          <Label htmlFor="chat-id">{t("channels.chatIdLabel")}</Label>
          <Input
            id="chat-id"
            type="text"
            inputMode="numeric"
            required
            placeholder={t("channels.chatIdPlaceholder")}
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            disabled={createChannel.isPending}
          />
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {t("channels.chatIdHint")}
            <code className="ml-1 rounded bg-slate-100 px-1 dark:bg-slate-800">123456789</code>.
          </p>
        </div>
        <div>
          <Label>{t("channels.languageLabel")}</Label>
          <SegmentedControl
            label={t("channels.languageLabel")}
            options={LANGUAGE_OPTIONS}
            value={language}
            onChange={setLanguage}
          />
        </div>
        {errorMessage ? <ErrorBox message={errorMessage} /> : null}
        <Button type="submit" disabled={createChannel.isPending}>
          {createChannel.isPending ? <Spinner label={t("channels.adding")} /> : t("channels.add")}
        </Button>
      </form>
    </div>
  );
}
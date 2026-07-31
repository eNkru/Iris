"use client";

import { useState, type FormEvent } from "react";
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
  Spinner,
} from "./ui";

/**
 * Alert channel management (R11/R12). MVP supports one Telegram channel per
 * user; chat id is the only configurable field.
 */
export function ChannelsSection() {
  const { data, isLoading, isError, error } = useChannels();
  const createChannel = useCreateChannel();
  const updateChannel = useUpdateChannel();
  const deleteChannel = useDeleteChannel();

  const [chatId, setChatId] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const channels = data?.channels ?? [];

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);

    if (!/^\d+$/.test(chatId.trim())) {
      setErrorMessage("Chat id must be a string of digits.");
      return;
    }

    try {
      await createChannel.mutateAsync({ channelType: "telegram", chatId: chatId.trim() });
      setChatId("");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to add channel.");
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setErrorMessage(null);
    try {
      await deleteChannel.mutateAsync(id);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to delete channel.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {isLoading ? <Spinner label="Loading channels…" /> : null}
      {isError ? (
        <ErrorBox
          message={error instanceof Error ? error.message : "Failed to load channels."}
        />
      ) : null}

      {channels.length > 0 ? (
        <div className="space-y-2">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">
                  Telegram · chat {String(channel.config.chatId ?? "?")}
                </p>
                <p className="text-xs text-slate-500">
                  {channel.enabled ? "Enabled" : "Disabled"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ButtonSecondary
                  onClick={() =>
                    updateChannel.mutate({ id: channel.id, enabled: !channel.enabled }, {
                      onError: (err) => setErrorMessage(err.message),
                    })
                  }
                  disabled={updateChannel.isPending}
                >
                  {channel.enabled ? "Disable" : "Enable"}
                </ButtonSecondary>
                <ButtonDanger
                  onClick={() => handleDelete(channel.id)}
                  disabled={deletingId === channel.id || deleteChannel.isPending}
                >
                  {deletingId === channel.id ? "Deleting…" : "Delete"}
                </ButtonDanger>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          No alert channels yet. Add your Telegram chat id to receive price alerts.
        </p>
      )}

      <form onSubmit={onSubmit} className="max-w-md space-y-3">
        <div>
          <Label htmlFor="chat-id">Telegram chat id</Label>
          <Input
            id="chat-id"
            type="text"
            inputMode="numeric"
            required
            placeholder="e.g. 123456789"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            disabled={createChannel.isPending}
          />
          <p className="mt-1 text-xs text-slate-400">
            The numeric chat id of your Telegram conversation with the bot.
          </p>
        </div>
        {errorMessage ? <ErrorBox message={errorMessage} /> : null}
        <Button type="submit" disabled={createChannel.isPending}>
          {createChannel.isPending ? <Spinner label="Adding…" /> : "Add channel"}
        </Button>
      </form>
    </div>
  );
}

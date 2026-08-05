"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useUpdateUserSettings, useUserSettings } from "../hooks/use-settings";
import { Button, ErrorBox, Input, Label, Spinner } from "./ui";

/**
 * Per-user settings (R7): the default poll interval applied to products that
 * have no per-product override. Empty = fall back to the instance default.
 */
export function UserSettingsSection() {
  const { data, isLoading, isError, error } = useUserSettings();
  const updateUserSettings = useUpdateUserSettings();

  const [pollInterval, setPollInterval] = useState("");
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

  // Seed the form once settings arrive from the server.
  useEffect(() => {
    if (data && !hasLoaded) {
      setPollInterval(data.settings.pollIntervalDefaultMinutes?.toString() ?? "");
      setHasLoaded(true);
    }
  }, [data, hasLoaded]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    setSavedAt(null);

    const parsed = pollInterval === "" ? null : Number(pollInterval);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1)) {
      setErrorMessage("Poll interval must be a whole number of minutes (or empty).");
      return;
    }

    try {
      await updateUserSettings.mutateAsync({ pollIntervalDefaultMinutes: parsed });
      setSavedAt(Date.now());
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save settings.");
    }
  };

  return (
    <div className="space-y-4">
      {isLoading ? <Spinner label="Loading settings…" /> : null}
      {isError ? (
        <ErrorBox
          message={error instanceof Error ? error.message : "Failed to load settings."}
        />
      ) : null}
      {!isLoading && !isError ? (
        <form onSubmit={onSubmit} className="max-w-md space-y-3">
          <div>
            <Label htmlFor="default-interval">Default poll interval (minutes)</Label>
            <Input
              id="default-interval"
              type="number"
              min="1"
              step="1"
              placeholder="Empty = use instance default"
              value={pollInterval}
              onChange={(e) => {
                setSavedAt(null);
                setPollInterval(e.target.value);
              }}
              disabled={updateUserSettings.isPending}
            />
            <p className="mt-1 text-xs text-slate-400">
              Applied to new products and products without their own interval.
            </p>
          </div>
          {errorMessage ? <ErrorBox message={errorMessage} /> : null}
          {savedAt !== null ? (
            <p className="text-sm text-emerald-700">Saved.</p>
          ) : null}
          <Button type="submit" disabled={updateUserSettings.isPending}>
            {updateUserSettings.isPending ? <Spinner label="Saving…" /> : "Save settings"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

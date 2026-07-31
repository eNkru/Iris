"use client";

import { AppNav } from "../../components/app-nav";
import { AdminSettingsSection } from "../../components/admin-settings-section";
import { AuthGate } from "../../components/auth-gate";
import { ChannelsSection } from "../../components/channels-section";
import { UserSettingsSection } from "../../components/user-settings-section";
import { Card } from "../../components/ui";
import { useSession } from "../../hooks/use-session";

export default function SettingsPage() {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";

  return (
    <AuthGate>
      <div className="min-h-screen">
        <AppNav />
        <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
          <div>
            <h1 className="text-2xl font-semibold">Settings</h1>
            <p className="text-sm text-slate-500">
              Signed in as {user?.email}
              {isAdmin ? " (admin)" : ""}.
            </p>
          </div>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">Alert channels</h2>
            <ChannelsSection />
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">Your settings</h2>
            <UserSettingsSection />
          </Card>

          {isAdmin ? (
            <Card>
              <h2 className="mb-3 text-lg font-semibold">Global settings (admin)</h2>
              <AdminSettingsSection />
            </Card>
          ) : null}
        </main>
      </div>
    </AuthGate>
  );
}

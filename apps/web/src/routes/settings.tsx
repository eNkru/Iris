import { AdminSettingsSection } from "../components/admin-settings-section";
import { AppShell } from "../components/app-shell";
import { AuthGate } from "../components/auth-gate";
import { ChannelsSection } from "../components/channels-section";
import { UserSettingsSection } from "../components/user-settings-section";
import { Card, PageHeader } from "../components/ui";
import { useSession } from "../hooks/use-session";
import { useI18n } from "../lib/i18n";

export function SettingsPage() {
  const { t } = useI18n();
  const { user } = useSession();
  const isAdmin = user?.role === "admin";

  return (
    <AuthGate>
      <AppShell mainClassName="space-y-6">
        <PageHeader
          title={t("settings.title")}
          description={t("settings.signedInAs", {
            email: user?.email ?? "",
            admin: isAdmin ? t("settings.adminSuffix") : "",
          })}
        />

        <Card>
          <h2 className="mb-4 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {t("settings.alertChannels")}
          </h2>
          <ChannelsSection />
        </Card>

        <Card>
          <h2 className="mb-4 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {t("settings.yourSettings")}
          </h2>
          <UserSettingsSection />
        </Card>

        {isAdmin ? (
          <Card>
            <h2 className="mb-4 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {t("settings.globalAdmin")}
            </h2>
            <AdminSettingsSection />
          </Card>
        ) : null}
      </AppShell>
    </AuthGate>
  );
}

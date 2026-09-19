import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { queryClient } from "@/lib/queryClient";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";
import { OverviewPage } from "@/features/overview/OverviewPage";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { StudioPage } from "@/features/studio/StudioPage";
import { ConnectionsPage } from "@/features/connections/ConnectionsPage";
import { AnalyticsPage } from "@/features/analytics/AnalyticsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { QuickPostPage } from "@/features/quick/QuickPostPage";
import { RequestAccessPage } from "@/features/auth/RequestAccessPage";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/go/:token" element={<QuickPostPage />} />
          <Route path="/request-access" element={<RequestAccessPage />} />
          <Route element={<RequireAuth><AppShell /></RequireAuth>}>
            <Route index element={<OverviewPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="studio" element={<StudioPage />} />
            <Route path="connections" element={<ConnectionsPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<OverviewPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

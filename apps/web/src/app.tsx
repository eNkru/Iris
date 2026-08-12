import { Route, Routes } from "react-router";
import { HomePage } from "./routes/home";
import { LoginPage } from "./routes/login";
import { ProductDetailPage } from "./routes/product";
import { SettingsPage } from "./routes/settings";

/**
 * Root App component: React Router route definitions (design.md §Architecture).
 *
 * The layout shell (Providers → BrowserRouter → routes) is composed in
 * `src/main.tsx`. Each route page renders its own `AuthGate` + `AppShell`
 * wrapper (same pattern as the former Next App Router pages).
 *
 * Routes:
 * - `/`                → Home (product list + add form)
 * - `/login`           → Magic-link login
 * - `/products/:id`    → Product detail (chart + edit form)
 * - `/settings`        → User + admin settings
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/products/:id" element={<ProductDetailPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  );
}

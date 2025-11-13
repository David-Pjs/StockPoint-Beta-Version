import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import "./index.css";
import "./index"; // loads core (plans, helpers)

import AppShell from "./app/AppShell";

// auth
import Login from "./features/auth/Login";
import RegisterPage from "./features/auth/RegisterPage";

// dashboards (chooser)
import DashboardByPlan from "./features/dashboard/DashboardByPlan";

// Only loads in dev builds; safe for prod

// pages
import ProductsPage from "./features/products/ProductsPage";
import StockPOSPage from "./features/sales/StockPOSPage";
import TransactionsPage from "./features/sales/TransactionsPage";
import ReportsPage from "./features/reports/ReportsPage";
import SettingsPage from "./features/settings/SettingsPage";

// public Paystack callback
import BillingCallback from "./features/billing/BillingCallback";

const router = createBrowserRouter([
  // public callback (not inside AppShell)
  { path: "/billing/callback", element: <BillingCallback /> },

  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardByPlan /> },  // ← auto-picks correct dashboard
      { path: "login", element: <Login /> },
      { path: "register", element: <RegisterPage /> },
      { path: "products", element: <ProductsPage /> },
      { path: "sales", element: <StockPOSPage /> },
      { path: "transactions", element: <TransactionsPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },

  { path: "*", element: <Navigate to="/" replace /> },
]);

const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);

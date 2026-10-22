import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./components/ui/ui.css";
import App from "./App";
import { OrgsProvider } from "./hooks/useOrgs";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OrgsProvider>
      <App />
    </OrgsProvider>
  </React.StrictMode>
);

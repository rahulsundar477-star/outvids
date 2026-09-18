import type { Metadata } from "next";
import { Suspense } from "react";
import CheckoutReturn from "@/components/CheckoutReturn";

export const metadata: Metadata = {
  title: { absolute: "Checkout · Outvids" },
  robots: { index: false, follow: false },
};

export default function CheckoutReturnPage() {
  return (
    <main
      className="ov-doc"
      style={{ display: "flex", flexDirection: "column" }}
    >
      <Suspense fallback={null}>
        <CheckoutReturn />
      </Suspense>
    </main>
  );
}

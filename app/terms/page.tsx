import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Terms — RAG FOR ALL",
  description: "Private-beta terms for using RAG FOR ALL.",
  openGraph: { title: "Terms — RAG FOR ALL", description: "Private-beta terms for using RAG FOR ALL.", images: [] },
  twitter: { title: "Terms — RAG FOR ALL", description: "Private-beta terms for using RAG FOR ALL.", images: [] },
};

export default function TermsPage() {
  return <LegalPage
    eyebrow="PRIVATE-BETA TERMS"
    title="Learn from the machinery. Double-check the answer."
    introduction="RAG FOR ALL is an experimental learning product, not a production decision system. By using the private beta, you agree to the terms below."
    sections={[
      { title: "What this beta is for", paragraphs: ["The service helps invited testers understand, visualize, and compare a Retrieval-Augmented Generation pipeline. Features, limits, availability, and stored records may change while the product is being tested."] },
      { title: "Your responsibilities", bullets: ["Upload only files you have the right to use.", "Do not upload secrets, regulated personal data, medical records, financial credentials, or other highly sensitive material.", "Do not attempt to bypass access controls, usage limits, or interfere with other testers.", "Check source passages before relying on an AI-generated answer."] },
      { title: "AI output", paragraphs: ["Retrieval and model output can be incomplete, incorrect, or misleading. Citations show what evidence was supplied; they do not guarantee that the evidence was complete or interpreted correctly. Do not use the beta as the sole basis for legal, medical, financial, safety-critical, employment, or other high-impact decisions."] },
      { title: "Access and availability", paragraphs: ["Access is invitation-only and may be limited, suspended, or removed to protect the service, control cost, investigate misuse, or end the beta. The service is provided as available without a promise of uninterrupted operation or permanent storage."] },
      { title: "Data", paragraphs: ["Data handling is described in the Privacy Notice. Documents are intended to be temporary and may be deleted automatically or by the user. Keep your own copy of anything you need to preserve."] },
      { title: "Feedback", paragraphs: ["If you provide feedback, it may be used to improve the product. Do not include confidential information in feedback reports."] },
      { title: "Changes", paragraphs: ["These terms may be updated as the private beta changes. Continued use after an update means you accept the revised terms."] },
    ]}
  />;
}

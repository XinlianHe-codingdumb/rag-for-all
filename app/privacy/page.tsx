import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Privacy — RAG FOR ALL",
  description: "How the RAG FOR ALL private beta handles documents, model requests, retention, and deletion.",
  openGraph: { title: "Privacy — RAG FOR ALL", description: "How the private beta handles documents and model requests.", images: [] },
  twitter: { title: "Privacy — RAG FOR ALL", description: "How the private beta handles documents and model requests.", images: [] },
};

export default function PrivacyPage() {
  return <LegalPage
    eyebrow="PLAIN-ENGLISH PRIVACY NOTICE"
    title="Your document is here to teach the pipeline—not train a mystery machine."
    introduction="RAG FOR ALL is a private educational beta. This notice explains what we collect, where it goes, and how you can remove it."
    sections={[
      { title: "What we handle", bullets: ["Your signed-in account identifier, used to keep your records separate from other testers.", "Documents you choose to upload, their parsed text, and basic metadata such as file name, size, type, and page count.", "Questions, pipeline settings, retrieved passages, and experiment results needed to run and explain your RAG workflow.", "Operational metadata such as request ID, route, timing, model name, token counts, file size, and error type."] },
      { title: "Where your data goes", paragraphs: ["Uploaded file bytes are stored in private object storage and document/run metadata is stored in the project database. Records are linked to the signed-in user on the server.", "When OpenAI-powered Embedding, Reranking, or Answer steps are used, the relevant text, question, and selected passages are sent to the configured OpenAI API. Those requests are sent with API storage disabled. Local fallback steps do not send their text to OpenAI.", "Cloud infrastructure and model providers may process data in locations outside your country. Do not use this private beta for data that has regulatory, contractual, or residency requirements."] },
      { title: "What our logs do not contain", paragraphs: ["Operational logs are designed not to contain document bodies, complete prompts, email addresses, or API keys. They use an opaque account hash so failures and usage can be investigated without putting the document into a log line."] },
      { title: "Retention and deletion", paragraphs: ["Saved documents, parsed text, and linked experiment history are scheduled for automatic deletion seven days after upload. Cleanup runs as part of service maintenance, so removal may not happen at the exact minute the period ends.", "You can delete the current document immediately from the Document step. The same action removes its stored original, parsed copy, and linked run history. Temporary browser-only sample content is not uploaded."] },
      { title: "Your choices", bullets: ["Use non-sensitive test documents during the private beta.", "Delete a document whenever you no longer need it.", "Stop using the beta and ask the person who invited you to remove your access.", "Report a privacy or deletion concern to the beta owner who invited you."] },
      { title: "Changes", paragraphs: ["This beta will evolve. If data handling changes materially, this notice will be updated before the new behavior is used for testers."] },
    ]}
  />;
}

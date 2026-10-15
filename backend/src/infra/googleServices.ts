import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import { TranslationServiceClient } from '@google-cloud/translate';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { SpeechClient } from '@google-cloud/speech';
import type { OcrEngine, SpeechService, Translator } from '../ports';

/** Google Cloud Document AI (OCR processor). Disabled when no processor is configured. */
export class DocumentAiOcr implements OcrEngine {
  readonly name = 'documentai-ocr';
  private client: DocumentProcessorServiceClient | null = null;
  constructor(private readonly processorName: string | null, private readonly location: string) {}
  get enabled(): boolean {
    return !!this.processorName;
  }
  async extractText(data: Buffer, mimeType: string): Promise<{ text: string; pageCount: number }> {
    if (!this.processorName) throw new Error('Document AI processor not configured');
    this.client ??= new DocumentProcessorServiceClient({ apiEndpoint: `${this.location}-documentai.googleapis.com` });
    const [result] = await this.client.processDocument({
      name: this.processorName,
      rawDocument: { content: data.toString('base64'), mimeType },
    });
    return { text: result.document?.text ?? '', pageCount: result.document?.pages?.length ?? 0 };
  }
}

/** Cloud Translation API (v3). */
export class CloudTranslator implements Translator {
  private client = new TranslationServiceClient();
  constructor(private readonly project: string) {}
  async translate(text: string, target: string, source?: string) {
    const [res] = await this.client.translateText({
      parent: `projects/${this.project}/locations/global`,
      contents: [text],
      mimeType: 'text/plain',
      targetLanguageCode: target,
      sourceLanguageCode: source,
    });
    const t = res.translations?.[0];
    return { text: t?.translatedText ?? text, detectedSource: t?.detectedLanguageCode ?? source ?? null };
  }
}

/**
 * Cloud Speech-to-Text and Text-to-Speech.
 * Locale support differs by product and changes over time: verify against
 * https://cloud.google.com/speech-to-text/docs/speech-to-text-supported-languages and
 * https://cloud.google.com/text-to-speech/docs/voices before enabling a language in production.
 */
export class GoogleSpeech implements SpeechService {
  private tts = new TextToSpeechClient();
  private stt = new SpeechClient();
  // Configurable via env SPEECH_LOCALES_JSON. null = not enabled for that language.
  constructor(private readonly locales: { tts: Record<string, string | null>; stt: Record<string, string | null> }) {}

  supportedLocales() {
    return this.locales;
  }

  async synthesize(text: string, language: string) {
    const locale = this.locales.tts[language];
    if (!locale) throw new Error(`Text-to-Speech is not enabled for language "${language}"`);
    const [res] = await this.tts.synthesizeSpeech({
      input: { text },
      voice: { languageCode: locale },
      audioConfig: { audioEncoding: 'MP3' },
    });
    const audio = res.audioContent ? Buffer.from(res.audioContent as Uint8Array).toString('base64') : '';
    return { audioBase64: audio, mimeType: 'audio/mpeg' };
  }

  async transcribe(audioBase64: string, mimeType: string, language: string) {
    const locale = this.locales.stt[language];
    if (!locale) throw new Error(`Speech-to-Text is not enabled for language "${language}"`);
    const encoding = mimeType.includes('webm') ? 'WEBM_OPUS' : mimeType.includes('ogg') ? 'OGG_OPUS' : 'ENCODING_UNSPECIFIED';
    const [res] = await this.stt.recognize({
      audio: { content: audioBase64 },
      config: { languageCode: locale, encoding: encoding as 'WEBM_OPUS', enableAutomaticPunctuation: true },
    });
    const alt = res.results?.[0]?.alternatives?.[0];
    const total = res.totalBilledTime;
    const seconds = total ? Number(total.seconds ?? 0) + Number(total.nanos ?? 0) / 1e9 : 0;
    return { transcript: alt?.transcript ?? '', confidence: alt?.confidence ?? null, durationSeconds: seconds };
  }
}

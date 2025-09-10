import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBfziAtBRKaXMCUKAy3WO-N1L9XbREEgSc';

if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is required');
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

console.log('Gemini API initialized with key:', GEMINI_API_KEY ? 'Present' : 'Missing');

// Supported languages for Indian regional translation
export const SUPPORTED_LANGUAGES = {
  'en': 'English',
  'hi': 'Hindi',
  'ta': 'Tamil', 
  'te': 'Telugu',
  'kn': 'Kannada',
  'ml': 'Malayalam',
  'bn': 'Bengali',
  'mr': 'Marathi',
  'gu': 'Gujarati',
  'pa': 'Punjabi'
} as const;

export type LanguageCode = keyof typeof SUPPORTED_LANGUAGES;

interface TranslationRequest {
  text: string;
  fromLanguage: LanguageCode;
  toLanguage: LanguageCode;
  context?: 'service' | 'requirement' | 'profile' | 'general';
}

export async function translateText({ 
  text, 
  fromLanguage, 
  toLanguage, 
  context = 'general' 
}: TranslationRequest): Promise<string> {
  try {
    console.log(`Translation request: "${text}" from ${fromLanguage} to ${toLanguage}`);
    
    // If same language, return original text
    if (fromLanguage === toLanguage) {
      console.log('Same language detected, returning original text');
      return text;
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const fromLang = SUPPORTED_LANGUAGES[fromLanguage];
    const toLang = SUPPORTED_LANGUAGES[toLanguage];
    
    // Create context-aware prompt
    let contextPrompt = '';
    switch (context) {
      case 'service':
        contextPrompt = 'This is about cooking/maid services. ';
        break;
      case 'requirement':
        contextPrompt = 'This is about household service requirements. ';
        break;
      case 'profile':
        contextPrompt = 'This is profile information for a service provider. ';
        break;
      default:
        contextPrompt = '';
    }

    const prompt = `${contextPrompt}Translate the following text from ${fromLang} to ${toLang}. 
    
    IMPORTANT RULES:
    1. Translate descriptive content, cooking terms, and service descriptions
    2. DO NOT translate: phone numbers, email addresses, prices (₹), specific addresses (Block/Flat numbers), timestamps, usernames
    3. Keep English words that are commonly understood: "Block", "Flat", numbers, "₹", "By:", phone numbers, time formats
    4. Focus on translating the actual service/requirement description and user-facing labels like "Priority", "Preferred Time", "Budget", "Location"
    5. Preserve formatting, emojis, and structure exactly
    6. Translate labels like "BOTHLOW Priority" → "निम्न प्राथमिकता" but keep "Block J Flat 103" as is
    7. Keep cooking terms, food names, and service-related terminology accurate for Indian context
    
    Only return the translated text, nothing else.
    
    Text to translate: "${text}"`;

    console.log('Sending request to Gemini API...');
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const translatedText = response.text().trim();
    
    console.log(`Gemini response: "${translatedText}"`);
    
    // Remove any quotes that might be added by the model
    return translatedText.replace(/^["']|["']$/g, '');
  } catch (error) {
    console.error('Translation error:', error);
    
    // If it's a quota error, try mock translations
    if (error instanceof Error && error.message.includes('429')) {
      console.log('API quota exceeded, returning original text');
    }
    
    // Fallback to original text if translation fails
    return text;
  }
}

// Batch translation for multiple texts
export async function translateBatch(
  texts: string[], 
  fromLanguage: LanguageCode, 
  toLanguage: LanguageCode,
  context?: 'service' | 'requirement' | 'profile' | 'general'
): Promise<string[]> {
  try {
    // Process in batches to avoid hitting API limits
    const batchSize = 5;
    const results: string[] = [];
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const promises = batch.map(text => 
        translateText({ text, fromLanguage, toLanguage, context })
      );
      const batchResults = await Promise.all(promises);
      results.push(...batchResults);
    }
    
    return results;
  } catch (error) {
    console.error('Batch translation error:', error);
    return texts; // Return original texts on error
  }
}

// Auto-detect language (simplified version)
export async function detectLanguage(text: string): Promise<LanguageCode> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `Detect the language of this text. Respond with only the language code from this list:
    en (English), hi (Hindi), ta (Tamil), te (Telugu), kn (Kannada), ml (Malayalam), 
    bn (Bengali), mr (Marathi), gu (Gujarati), pa (Punjabi)
    
    Text: "${text}"
    
    Response format: Just the language code (e.g., "hi")`;

    console.log('Detecting language for:', text);
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const detectedLang = response.text().trim().toLowerCase();
    
    console.log('Detected language:', detectedLang);
    
    // Validate the detected language is in our supported list
    if (detectedLang in SUPPORTED_LANGUAGES) {
      return detectedLang as LanguageCode;
    }
    
    // Default to English if detection fails
    return 'en';
  } catch (error) {
    console.error('Language detection error:', error);
    return 'en'; // Default to English
  }
}

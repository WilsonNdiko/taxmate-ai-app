import { fileToBase64 } from '../utils'; // Ensure this import exists

// Define the API URL at top (fixes no-undef)
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.REACT_APP_GEMINI_API_KEY || ''}`;

export const processReceiptWithAI = async (base64Image) => {
    const userPrompt = `
You are an expert OCR assistant for extracting KEY financial data from receipts/invoices. CRITICALLY: RESPOND WITH ABSOLUTELY NO EXTRA TEXT—ONLY VALID JSON OBJECT MATCHING THE SCHEMA BELOW. Do not describe, explain, or output raw text. Ignore all other details (e.g., addresses, terms, QR codes).

FOCUS:
- Vendor: ONLY the issuing company/store name (top-left/header, e.g., "ABC Design Co."—exclude reg no., VAT no., email, phone).
- Date: Invoice/Receipt date in YYYY-MM-DD (parse from "Invoice Date: 23/02/2021" → "2021-02-23").
- Total Amount: Final total as number (e.g., "Total GBP 900.00" → 900).
- VAT Amount: Explicit VAT line as number (e.g., "VAT 20% of 750.00 150.00" → 150); if unclear, 0.
- Type: "Income" if invoice/sale (billed to customer); "Expense" if receipt/purchase.

Step-by-Step Reasoning (INTERNAL—do not output):
1. Scan header for vendor (first bold company name).
2. Locate date near "Invoice Date" or top-right.
3. Find "Total" at bottom.
4. Check VAT subtotal.
5. Classify by "Bill to" (income) vs. "Thank you" (expense).

EXAMPLES (JSON ONLY):
Input: [Image of your provided invoice]
Output: {"vendor": "ABC Design Co.", "date": "2021-02-23", "totalAmount": 900, "vatAmount": 150, "type": "Income"}

Input: [Blurry receipt]
Output: {"vendor": "Unknown Vendor", "date": "Unknown Date", "totalAmount": 0, "vatAmount": 0, "type": "Expense"}

Schema (ENFORCE STRICTLY):
{
  "vendor": "string (max 50 chars)",
  "date": "string (YYYY-MM-DD or Unknown Date)",
  "totalAmount": number,
  "vatAmount": number,
  "type": "Income" | "Expense"
}
`;

    const payload = {
        contents: [
            {
                role: "user",
                parts: [
                    { text: userPrompt },
                    {
                        inlineData: {
                            mimeType: "image/jpeg", // Or "image/png" if needed
                            data: base64Image
                        }
                    }
                ]
            }
        ],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    vendor: { type: "STRING", maxLength: 50 },
                    date: { type: "STRING" },
                    totalAmount: { type: "NUMBER" },
                    vatAmount: { type: "NUMBER" },
                    type: { type: "STRING", enum: ["Income", "Expense"] }
                },
                required: ["vendor", "date", "totalAmount", "vatAmount", "type"] // Enforce all fields
            },
            topK: 1, // Single, focused output
            temperature: 0.1 // Low randomness for consistency
        },
    };

    const MAX_RETRIES = 5;
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const response = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const result = await response.json();
            console.log('Raw API Response:', result); // Debug: Check this in console
            const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
                const parsed = JSON.parse(text);
                console.log('Parsed AI Data:', parsed); // Debug output
                return parsed; // Returns clean {vendor: "ABC Design Co.", ...}
            }
        } catch (error) {
            console.error(`Attempt ${i + 1} failed:`, error);
            if (i < MAX_RETRIES - 1) {
                const delay = Math.pow(2, i) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw new Error("AI processing failed after multiple retries.");
            }
        }
    }
};

// Export handleFileChange (already there, but ensure)
export const handleFileChange = async (file, onSuccess, onError) => {
    try {
        const base64Image = await fileToBase64(file);
        const aiData = await processReceiptWithAI(base64Image); // Now "used" via export
        onSuccess(aiData);
    } catch (e) {
        onError(e.message || 'AI processing failed');
    }
};
// Matches any US style phone number, so the guard never has to contain the real one.
export const PHONE = /(?<![\d.,])\(?\d{3}\)?[-.\s\u2010]\d{3}[-.\s\u2010]\d{4}(?!\d)/;

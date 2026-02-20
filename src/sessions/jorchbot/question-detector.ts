export interface DetectedQuestion {
  isQuestion: boolean;
  type: "yes-no" | "multi-option";
  questionText: string;
  options: string[];
}

const NUMBERED_PATTERN = /^\s*(\d+)[.)]\s+(.+)/;
const LETTERED_PATTERN = /^\s*([a-z])[.)]\s+(.+)/i;
const BULLET_PATTERN = /^\s*[-*]\s+(.+)/;

/**
 * Detect whether text from Claude contains a question, and extract options if present.
 *
 * - Finds the last line containing "?" as the question text.
 * - Scans all lines for numbered (1. / 1)), lettered (a. / a)), or bullet (- / *) options.
 * - If options found → multi-option; if "?" found but no options → yes-no.
 */
export function detectQuestion(text: string): DetectedQuestion {
  const notAQuestion: DetectedQuestion = {
    isQuestion: false,
    type: "yes-no",
    questionText: "",
    options: [],
  };

  if (!text.trim()) {
    return notAQuestion;
  }

  const lines = text.split("\n");

  // Find last line containing "?"
  let questionText = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes("?")) {
      questionText = lines[i].trim();
      break;
    }
  }

  if (!questionText) {
    return notAQuestion;
  }

  // Scan ALL lines for option patterns
  const options: string[] = [];
  for (const line of lines) {
    const numbered = NUMBERED_PATTERN.exec(line);
    if (numbered) {
      options.push(numbered[2].trim());
      continue;
    }

    const lettered = LETTERED_PATTERN.exec(line);
    if (lettered) {
      options.push(lettered[2].trim());
      continue;
    }

    const bullet = BULLET_PATTERN.exec(line);
    if (bullet) {
      options.push(bullet[1].trim());
      continue;
    }
  }

  if (options.length > 0) {
    return {
      isQuestion: true,
      type: "multi-option",
      questionText,
      options,
    };
  }

  return {
    isQuestion: true,
    type: "yes-no",
    questionText,
    options: [],
  };
}

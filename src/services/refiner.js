import { callAI } from './ai';

/**
 * Surgically refine a specific lab task based on user instructions
 */
export async function refineLabTask(task, userInstructions, provider, apiKey, model) {
  const prompt = `You are an expert Python and Data Science assistant. You are refining a single piece of a LINEAR JUPYTER NOTEBOOK.
  
  CURRENT TASK:
  Title: ${task.title}
  Description: ${task.description}
  Solution: ${task.solution || 'None'}
  Code:
  '''python
  ${task.code || '# No code yet'}
  '''
  
  USER REFINEMENT INSTRUCTIONS:
  "${userInstructions}"
  
  CRITICAL RULES:
  1. This is Task ${task.taskNumber}. It is part of a linear execution. Assume variables from previous cells exist.
  2. Return the UPDATED task as a JSON object with these keys: title, description, solution, code, hasCode, expectedOutput, outputAnalysis.
  3. Ensure the 'code' is professional and uses industry-standard libraries (TF, Sklearn, etc.) as requested.
  4. Return ONLY the JSON object. No extra text.`;

  return await callAI(prompt, provider, apiKey, model, true);
}

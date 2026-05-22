/**
 * Rating algorithms for engagement scoring.
 */

/**
 * Calculate confidence level based on vote count.
 * @param voteCount - Number of votes
 * @returns Confidence level string
 */
export function getConfidenceLevel(voteCount: number): 'low' | 'medium' | 'high' | 'very_high' {
  if (voteCount < 5) {
    return 'low';
  } else if (voteCount < 20) {
    return 'medium';
  } else if (voteCount < 100) {
    return 'high';
  } else {
    return 'very_high';
  }
}

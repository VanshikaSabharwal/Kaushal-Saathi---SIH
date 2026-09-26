/**
 * Logistic regression, small enough to read in one sitting.
 *
 * Chosen over a heavier model on purpose: each weight is one sentence an
 * officer can check ("family support raises the odds of finishing"), the model
 * ships as a few dozen numbers, and it runs in the same process as the
 * recommender with no serving layer. Features are standardised, trained by
 * batch gradient descent with L2, and evaluated by AUC.
 */

export type LogisticModel = {
  features: readonly string[];
  mean: number[];
  std: number[];
  weights: number[];
  bias: number;
};

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function standardise(X: number[][]): { mean: number[]; std: number[] } {
  const d = X[0].length;
  const mean = Array(d).fill(0);
  const std = Array(d).fill(0);

  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / X.length;
  for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2 / X.length;

  // A constant feature has no spread; dividing by 1 leaves it inert.
  return { mean, std: std.map((v) => Math.sqrt(v) || 1) };
}

export function train(
  X: number[][],
  y: number[],
  features: readonly string[],
  opts: { iterations?: number; rate?: number; l2?: number } = {},
): LogisticModel {
  const { iterations = 800, rate = 0.3, l2 = 1e-3 } = opts;
  const { mean, std } = standardise(X);
  const Z = X.map((x) => x.map((v, j) => (v - mean[j]) / std[j]));
  const d = features.length;

  const w = Array(d).fill(0);
  let b = 0;

  for (let it = 0; it < iterations; it++) {
    const gw = Array(d).fill(0);
    let gb = 0;

    for (let i = 0; i < Z.length; i++) {
      const err = sigmoid(Z[i].reduce((s, v, j) => s + v * w[j], b)) - y[i];
      for (let j = 0; j < d; j++) gw[j] += (err * Z[i][j]) / Z.length;
      gb += err / Z.length;
    }

    for (let j = 0; j < d; j++) w[j] -= rate * (gw[j] + l2 * w[j]);
    b -= rate * gb;
  }

  return { features, mean, std, weights: w, bias: b };
}

export function predict(m: LogisticModel, x: number[]): number {
  return sigmoid(x.reduce((s, v, j) => s + ((v - m.mean[j]) / m.std[j]) * m.weights[j], m.bias));
}

/** Each feature's push on this prediction, in log-odds. */
export function contributions(m: LogisticModel, x: number[]): { feature: string; value: number }[] {
  return x.map((v, j) => ({ feature: m.features[j], value: ((v - m.mean[j]) / m.std[j]) * m.weights[j] }));
}

/**
 * Area under the ROC curve: the chance a random positive is scored above a
 * random negative. 0.5 is a coin toss. Ties count half.
 */
export function auc(scores: number[], labels: number[]): number {
  const pairs = scores.map((s, i) => ({ s, y: labels[i] })).sort((a, b) => a.s - b.s);
  let rankSum = 0;
  let positives = 0;

  for (let i = 0; i < pairs.length; ) {
    let j = i;
    while (j < pairs.length && pairs[j].s === pairs[i].s) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (pairs[k].y === 1) {
      rankSum += avgRank;
      positives++;
    }
    i = j;
  }

  const negatives = pairs.length - positives;
  if (positives === 0 || negatives === 0) return 0.5;
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

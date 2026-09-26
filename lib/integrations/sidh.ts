/**
 * Skill India Digital Hub (SIDH) connector.
 *
 * SIDH holds learners' enrolments, progress and certificates, but offers no
 * public API for a third party to read them: access needs a government
 * partnership and the learner's consent. The interface below is what the
 * integration will implement; the mock stands in for it in the MVP and says
 * so in every response, so a demo can never be mistaken for real data.
 */

export type SidhRecord = {
  mock: boolean;
  note: string;
  enrolments: {
    courseName: string;
    status: "enrolled" | "in_progress" | "completed";
    progressPercent: number;
    certificateAvailable: boolean;
  }[];
};

export interface SidhConnector {
  learnerRecord(input: { phone?: string; courseName?: string; status: string }): Promise<SidhRecord>;
}

export class MockSidhConnector implements SidhConnector {
  async learnerRecord(input: { phone?: string; courseName?: string; status: string }): Promise<SidhRecord> {
    const progress: Record<string, number> = {
      enrolled: 5,
      training: 50,
      certified: 100,
      placed: 100,
      self_employed: 100,
      retained: 100,
    };
    const pct = progress[input.status] ?? 0;

    return {
      mock: true,
      note: "DEMO DATA — the real Skill India Digital Hub link needs a government partnership and the learner's consent.",
      enrolments:
        input.courseName && pct > 0
          ? [
              {
                courseName: input.courseName,
                status: pct >= 100 ? "completed" : pct > 5 ? "in_progress" : "enrolled",
                progressPercent: pct,
                certificateAvailable: pct >= 100,
              },
            ]
          : [],
    };
  }
}

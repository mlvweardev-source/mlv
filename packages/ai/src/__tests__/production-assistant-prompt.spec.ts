import {
  buildProductionAssistantSystemPrompt,
  buildProductionAssistantUserPrompt,
} from '../prompt-templates/production-assistant';

describe('Production Assistant Prompt Templates', () => {
  describe('buildProductionAssistantSystemPrompt', () => {
    it('should return a non-empty system prompt', () => {
      const prompt = buildProductionAssistantSystemPrompt();
      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeGreaterThan(100);
    });

    it('should mention key rules about recommendations only', () => {
      const prompt = buildProductionAssistantSystemPrompt();
      expect(prompt).toContain('HANYA memberi saran');
      expect(prompt).toContain('TIDAK PERNAH');
    });

    it('should define JSON output structure', () => {
      const prompt = buildProductionAssistantSystemPrompt();
      expect(prompt).toContain('estimasi_lead_time');
      expect(prompt).toContain('bottleneck');
      expect(prompt).toContain('saran_urutan');
      expect(prompt).toContain('ringkasan');
    });
  });

  describe('buildProductionAssistantUserPrompt', () => {
    it('should include order number and status', () => {
      const prompt = buildProductionAssistantUserPrompt({
        orderNumber: 'MLV-20260719-0001',
        orderStatus: 'ANTREAN',
        tasks: [],
        taskCountByStage: {},
      });

      expect(prompt).toContain('MLV-20260719-0001');
      expect(prompt).toContain('ANTREAN');
    });

    it('should include task count by stage', () => {
      const prompt = buildProductionAssistantUserPrompt({
        orderNumber: 'MLV-20260719-0001',
        orderStatus: 'ANTREAN',
        tasks: [],
        taskCountByStage: {
          CUTTING: { total: 2, active: 1, waiting: 1 },
          SEWING: { total: 3, active: 2, waiting: 1 },
        },
      });

      expect(prompt).toContain('CUTTING');
      expect(prompt).toContain('SEWING');
      expect(prompt).toContain('2 aktif');
    });

    it('should include task details', () => {
      const prompt = buildProductionAssistantUserPrompt({
        orderNumber: 'MLV-20260719-0001',
        orderStatus: 'ANTREAN',
        tasks: [
          {
            taskType: 'CUTTING',
            sequence: 1,
            status: 'SEDANG_DILAKSANAKAN',
            assignedToNama: 'Budi',
            productType: 'Kaos',
            startedAt: '2026-07-19T10:00:00Z',
          },
        ],
        taskCountByStage: {},
      });

      expect(prompt).toContain('CUTTING');
      expect(prompt).toContain('Budi');
      expect(prompt).toContain('Kaos');
    });
  });
});

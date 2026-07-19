import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { DesignAnalyzerModule } from './design-analyzer/design-analyzer.module';
import { QuotationAssistantModule } from './quotation-assistant/quotation-assistant.module';
import { CustomerSupportModule } from './customer-support/customer-support.module';
import { ProductionAssistantModule } from './production-assistant/production-assistant.module';
import { InventoryPredictionModule } from './inventory-prediction/inventory-prediction.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    DesignAnalyzerModule,
    QuotationAssistantModule, // Fase 12 Bagian 2: AI saran harga (§17.4)
    CustomerSupportModule, // Fase 12 Bagian 2: AI auto-reply chat (§9)
    ProductionAssistantModule, // Fase 12 Bagian 3: AI insight produksi (§9)
    InventoryPredictionModule, // Fase 12 Bagian 3: AI prediksi restock (§9)
  ],
  controllers: [AppController],
})
export class AppModule {}

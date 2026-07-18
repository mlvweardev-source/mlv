import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { DesignAnalyzerModule } from './design-analyzer/design-analyzer.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    DesignAnalyzerModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

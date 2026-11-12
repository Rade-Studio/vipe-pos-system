import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CartaController } from './carta.controller';
import { CartaService } from './carta.service';
import { RateLimitGuard, rateLimiterProvider } from './rate-limit';

/** Public digital menu (carta-digital T2): read-only, no login, rate-limited. */
@Module({
  imports: [CatalogModule],
  controllers: [CartaController],
  providers: [CartaService, RateLimitGuard, rateLimiterProvider],
})
export class CartaModule {}

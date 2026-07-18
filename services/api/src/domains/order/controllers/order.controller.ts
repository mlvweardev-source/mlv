import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { join, extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync } from 'fs';
import { OrderService } from '../services/order.service';
import {
  CreateOrderDto,
  AddOrderItemDto,
  UpdateOrderStatusDto,
  AddOrderServiceDto,
  FindOrdersQueryDto,
} from '../dto/order.dto';
import { AuthGuard, Roles, AllowCustomer } from '../../identity-access/guards/auth.guard';
import { UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';
import type { Prisma } from '@mlv/db';

// Define file interface compatible with multer
interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
  buffer: Buffer;
}

// Multer storage configuration for design uploads
const storage = {
  destination: (
    _req: unknown,
    _file: UploadedFile,
    cb: (error: Error | null, destination: string) => void,
  ) => {
    const uploadDir = join(process.cwd(), 'uploads', 'designs');
    if (!existsSync(uploadDir)) {
      mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (
    _req: unknown,
    file: UploadedFile,
    cb: (error: Error | null, filename: string) => void,
  ) => {
    const uniqueSuffix = uuidv4();
    const ext = extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
};

const fileFilter = (
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, accept: boolean) => void,
) => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipe file tidak diizinkan'), false);
  }
};

// Lazy import path untuk menghindari circular dependency
const path = { extname: (s: string) => s.split('.').pop() || '' };

@Controller('orders')
@UseGuards(AuthGuard)
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  // ==========================================
  // Order CRUD
  // ==========================================

  /**
   * POST /orders — Buat order baru (DRAFT).
   * Staff: buat untuk customer manapun. Customer: buat untuk dirinya sendiri.
   */
  @Post()
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  @AllowCustomer()
  async createOrder(@Body() dto: CreateOrderDto, @Req() req: { user: JwtPayload }) {
    return this.orderService.createOrder(dto, req.user);
  }

  /**
   * GET /orders — Daftar order dengan filter status & pencarian.
   * Staff: semua. Customer: miliknya sendiri.
   * Tim Penjahit: view terbatas — hanya order dengan task miliknya (§5.1).
   */
  @Get()
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI, UserRole.TIM_PENJAHIT)
  @AllowCustomer()
  async findOrders(@Query() query: FindOrdersQueryDto, @Req() req: { user: JwtPayload }) {
    return this.orderService.findOrders(req.user, query);
  }

  /**
   * GET /orders/check-availability — Cek ketersediaan stok produk real-time.
   */
  @Get('check-availability')
  @AllowCustomer()
  async checkAvailability(
    @Query('productType') productType: string,
    @Query('qty') qty: string,
  ) {
    const qtyNum = parseInt(qty, 10);
    if (!productType || isNaN(qtyNum) || qtyNum <= 0) {
      throw new BadRequestException('Parameter productType dan qty harus valid');
    }
    return this.orderService.checkAvailability(productType, qtyNum);
  }

  /**
   * GET /orders/:id — Detail order.
   * Tim Penjahit: hanya order dengan task miliknya (§5.1).
   */
  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI, UserRole.TIM_PENJAHIT)
  @AllowCustomer()
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: JwtPayload }) {
    return this.orderService.getOrderById(id, req.user);
  }

  /**
   * PATCH /orders/:id/status — Update status (checkout/cancel).
   */
  @Patch(':id/status')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  @AllowCustomer()
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.orderService.updateStatus(id, dto, req.user);
  }

  // ==========================================
  // Order Items
  // ==========================================

  /**
   * POST /orders/:id/items — Tambah item ke order.
   */
  @Post(':id/items')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  @AllowCustomer()
  async addItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddOrderItemDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.orderService.addOrderItem(id, dto, req.user);
  }

  /**
   * POST /orders/:id/items/:itemId/designs — Upload desain.
   */
  @Post(':id/items/:itemId/designs')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  @AllowCustomer()
  @UseInterceptors(
    FileInterceptor('file', {
      storage,
      fileFilter,
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    }),
  )
  async uploadDesign(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @UploadedFile() file: UploadedFile,
    @Body('catatanTeks') catatanTeks: string | undefined,
    @Req() req: { user: JwtPayload },
  ): Promise<Prisma.OrderDesignGetPayload<object>> {
    // Move file to correct location based on order/item
    const uploadDir = join(process.cwd(), 'uploads', 'designs', id, itemId);

    if (!existsSync(uploadDir)) {
      mkdirSync(uploadDir, { recursive: true });
    }

    // Move file from temp location to final destination
    const finalPath = join(uploadDir, file.originalname);
    const { renameSync } = await import('fs');
    renameSync(file.path, finalPath);

    // Update file path to store relative URL
    const fileUrl = `/uploads/designs/${id}/${itemId}/${file.originalname}`;

    return this.orderService.uploadDesignWithUrl(id, itemId, fileUrl, catatanTeks, req.user);
  }

  /**
   * POST /orders/:id/items/:itemId/services — Tambah layanan tambahan.
   */
  @Post(':id/items/:itemId/services')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  @AllowCustomer()
  async addService(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: AddOrderServiceDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.orderService.addOrderService(id, itemId, dto, req.user);
  }

  // ==========================================
  // Repeat Order
  // ==========================================

  /**
   * POST /orders/:id/duplicate — Duplikasi order.
   */
  @Post(':id/duplicate')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  @AllowCustomer()
  async duplicateOrder(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: JwtPayload }) {
    return this.orderService.duplicateOrder(id, req.user);
  }

  // ==========================================
  // Timeline
  // ==========================================

  /**
   * GET /orders/:id/timeline — Timeline order.
   * Tim Penjahit: hanya order dengan task miliknya (§5.1).
   */
  @Get(':id/timeline')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI, UserRole.TIM_PENJAHIT)
  @AllowCustomer()
  async getTimeline(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: JwtPayload }) {
    return this.orderService.getTimeline(id, req.user);
  }
}

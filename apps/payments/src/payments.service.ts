import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);

    async processPayment(order: any) {
        // ... Logic nghiệp vụ xử lý thanh toán ở đây ...
        // Ví dụ: gọi đến cổng thanh toán, cập nhật trạng thái giao dịch...
        this.logger.log(`Processing payment for order ${order.id}...`);
        
        // Giả lập một tác vụ mất thời gian
        await new Promise(resolve => setTimeout(resolve, 1000));

        this.logger.log(`Payment for order ${order.id} processed successfully.`);
    }
}
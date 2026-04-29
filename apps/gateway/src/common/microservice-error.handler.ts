import { HttpException, HttpStatus, Logger } from '@nestjs/common';

/**
 * Shared error handling utility for Gateway services
 * Properly handles RpcException from microservices and converts to HTTP exceptions
 */
export class MicroserviceErrorHandler {
  private static readonly logger = new Logger(MicroserviceErrorHandler.name);

  /**
   * Handle microservice errors and convert to appropriate HTTP exceptions
   * Properly handles RpcException from microservices
   */
  static handleError(error: any, operation: string, serviceName: string = 'Microservice'): never {
    this.logger.error(`${serviceName} ${operation} failed:`, error);
    
    // Handle RpcException from microservice
    const rpcError = error?.response || error;
    
    // Extract status code and message from RpcException
    const statusCode = this.extractStatusCode(rpcError);
    const message = this.extractErrorMessage(rpcError, operation);
    
    this.logger.debug(`Throwing HttpException with status: ${statusCode}, message: ${message}`);
    throw new HttpException(message, statusCode);
  }

  /**
   * Extract HTTP status code from RpcException or error object
   */
  private static extractStatusCode(error: any): number {
    // Priority 1: Direct statusCode from RpcException
    if (error.statusCode && typeof error.statusCode === 'number') {
      return error.statusCode;
    }
    
    // Priority 2: Legacy status property
    if (error.status && typeof error.status === 'number') {
      return error.status;
    }
    
    // Priority 3: Check error name for NestJS exception types
    if (error.name) {
      switch (error.name) {
        case 'ConflictException':
        case 'RpcException.ConflictException':
          return HttpStatus.CONFLICT; // 409
        case 'NotFoundException':
        case 'RpcException.NotFoundException':
          return HttpStatus.NOT_FOUND; // 404
        case 'BadRequestException':
        case 'RpcException.BadRequestException':
          return HttpStatus.BAD_REQUEST; // 400
        case 'UnauthorizedException':
        case 'RpcException.UnauthorizedException':
          return HttpStatus.UNAUTHORIZED; // 401
        case 'ForbiddenException':
        case 'RpcException.ForbiddenException':
          return HttpStatus.FORBIDDEN; // 403
        case 'UnprocessableEntityException':
        case 'RpcException.UnprocessableEntityException':
          return HttpStatus.UNPROCESSABLE_ENTITY; // 422
      }
    }
    
    // Priority 4: Parse error message for common patterns
    const errorMessage = (error.message || '').toLowerCase();
    
    if (errorMessage.includes('already exists') || 
        errorMessage.includes('duplicate') ||
        errorMessage.includes('unique constraint') ||
        errorMessage.includes('UQ_')) {
      return HttpStatus.CONFLICT; // 409
    }
    
    if (errorMessage.includes('not found') ||
        errorMessage.includes('does not exist')) {
      return HttpStatus.NOT_FOUND; // 404
    }
    
    if (errorMessage.includes('validation') || 
        errorMessage.includes('invalid') ||
        errorMessage.includes('required') ||
        errorMessage.includes('must be') ||
        errorMessage.includes('should not be empty')) {
      return HttpStatus.BAD_REQUEST; // 400
    }
    
    if (errorMessage.includes('timeout') || 
        errorMessage.includes('connection') ||
        errorMessage.includes('ETIMEDOUT')) {
      return HttpStatus.REQUEST_TIMEOUT; // 408
    }
    
    if (errorMessage.includes('unauthorized') ||
        errorMessage.includes('access denied')) {
      return HttpStatus.UNAUTHORIZED; // 401
    }
    
    if (errorMessage.includes('forbidden')) {
      return HttpStatus.FORBIDDEN; // 403
    }
    
    if (errorMessage.includes('insufficient') ||
        errorMessage.includes('not enough')) {
      return HttpStatus.UNPROCESSABLE_ENTITY; // 422
    }
    
    // Default to BAD_GATEWAY for microservice communication issues
    return HttpStatus.BAD_GATEWAY; // 502
  }

  /**
   * Extract meaningful error message from RpcException or error object
   */
  private static extractErrorMessage(error: any, operation?: string): string {
    // Priority 1: Direct message from RpcException
    if (error.message && typeof error.message === 'string') {
      return this.cleanupErrorMessage(error.message);
    }
    
    // Priority 2: Message array (for validation errors)
    if (Array.isArray(error.message)) {
      return error.message.join(', ');
    }
    
    // Priority 3: Error details from nested response
    if (error.response && error.response.message) {
      if (Array.isArray(error.response.message)) {
        return error.response.message.join(', ');
      }
      return this.cleanupErrorMessage(error.response.message);
    }
    
    // Priority 4: Error property
    if (error.error && typeof error.error === 'string') {
      return error.error;
    }
    
    // Priority 5: Default operation-specific message
    return 'Operation failed';
  }

  /**
   * Clean up technical error messages to be user-friendly
   */
  private static cleanupErrorMessage(message: string): string {
    // Handle TypeORM constraint errors
    if (message.includes('unique constraint')) {
      if (message.includes('sku') || message.includes('UQ_5ec10f972b1fa4f1e60d66d28bc')) {
        return 'Record with this SKU already exists';
      }
      if (message.includes('email')) {
        return 'User with this email already exists';
      }
      if (message.includes('username')) {
        return 'User with this username already exists';
      }
      if (message.includes('name')) {
        return 'Record with this name already exists';
      }
      if (message.includes('phone')) {
        return 'User with this phone number already exists';
      }
      if (message.includes('order_number')) {
        return 'Order with this number already exists';
      }
      if (message.includes('transaction_id')) {
        return 'Transaction with this ID already exists';
      }
      return 'Duplicate entry found';
    }
    
    // Handle common database errors
    if (message.includes('QueryFailedError')) {
      return 'Database operation failed';
    }
    
    if (message.includes('duplicate key value violates')) {
      return 'Duplicate entry found';
    }
    
    // Handle validation errors
    if (message.includes('should not be empty')) {
      return message.replace(/\b\w+\b should not be empty/g, (match) => {
        const field = match.split(' ')[0];
        return `${field} is required`;
      });
    }
    
    // Handle insufficient stock/points errors
    if (message.includes('insufficient stock')) {
      return 'Insufficient stock available';
    }
    
    if (message.includes('insufficient points')) {
      return 'Insufficient points available';
    }
    
    if (message.includes('not enough stock')) {
      return 'Not enough stock available';
    }
    
    if (message.includes('not enough points')) {
      return 'Not enough points available';
    }
    
    // Remove technical prefixes
    message = message.replace(/^(Error: |QueryFailedError: |ValidationError: )/i, '');
    
    return message;
  }

  /**
   * Async wrapper for handling microservice calls with error handling
   */
  static async handleAsyncCall<T>(
    operation: () => Promise<T>,
    operationName: string,
    serviceName: string = 'Microservice'
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.handleError(error, operationName, serviceName);
    }
  }
}
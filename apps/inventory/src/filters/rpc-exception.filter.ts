import { 
  Catch, 
  ArgumentsHost, 
  HttpException, 
  HttpStatus,
  Logger 
} from '@nestjs/common';
import { BaseRpcExceptionFilter, RpcException } from '@nestjs/microservices';

/**
 * Global RPC Exception Filter for Inventory Service
 * Converts HttpException to RpcException for proper microservice communication
 */
@Catch()
export class AllRpcExceptionFilter extends BaseRpcExceptionFilter {
  private readonly logger = new Logger(AllRpcExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    this.logger.debug(`Handling exception: ${exception?.constructor?.name}`, exception?.message);
    
    // If it's already an RpcException, pass it through
    if (exception instanceof RpcException) {
      this.logger.debug('Already RpcException, passing through');
      return super.catch(exception, host);
    }
    
    // Convert HttpException to RpcException
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      
      const rpcException = new RpcException({
        statusCode: status,
        message: typeof response === 'string' ? response : (response as any)?.message || exception.message,
        error: this.getErrorName(status),
        timestamp: new Date().toISOString(),
      });
      
      this.logger.debug(`Converted HttpException to RpcException: ${status} - ${exception.message}`);
      return super.catch(rpcException, host);
    }
    
    // Handle TypeORM/Database errors
    if (this.isDatabaseError(exception)) {
      const rpcException = this.handleDatabaseError(exception);
      this.logger.debug(`Converted Database error to RpcException: ${rpcException.getError()}`);
      return super.catch(rpcException, host);
    }
    
    // Handle validation errors
    if (this.isValidationError(exception)) {
      const rpcException = this.handleValidationError(exception);
      this.logger.debug(`Converted Validation error to RpcException: ${rpcException.getError()}`);
      return super.catch(rpcException, host);
    }
    
    // Default: convert to RpcException with 500 status
    const rpcException = new RpcException({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: exception?.message || 'Internal server error',
      error: 'Internal Server Error',
      timestamp: new Date().toISOString(),
    });
    
    this.logger.error(`Unhandled exception converted to RpcException:`, exception);
    return super.catch(rpcException, host);
  }

  /**
   * Check if error is a database-related error
   */
  private isDatabaseError(exception: any): boolean {
    return (
      exception?.constructor?.name === 'QueryFailedError' ||
      exception?.code === '23505' || // PostgreSQL unique violation
      exception?.code === '23502' || // PostgreSQL not null violation
      exception?.code === '23503' || // PostgreSQL foreign key violation
      exception?.message?.includes('duplicate key value violates') ||
      exception?.message?.includes('unique constraint') ||
      exception?.message?.includes('foreign key constraint')
    );
  }

  /**
   * Check if error is a validation error
   */
  private isValidationError(exception: any): boolean {
    return (
      exception?.constructor?.name === 'ValidationError' ||
      Array.isArray(exception?.message) ||
      exception?.message?.includes('should not be empty') ||
      exception?.message?.includes('must be') ||
      exception?.message?.includes('is not valid')
    );
  }

  /**
   * Handle database errors and convert to appropriate RpcException
   */
  private handleDatabaseError(exception: any): RpcException {
    const message = exception.message || '';
    
    // Handle unique constraint violations
    if (message.includes('duplicate key value violates') || exception.code === '23505') {
      let userMessage = 'Duplicate entry found';
      
      // Specific handling for SKU constraint (inventory has unique SKU too)
      if (message.includes('UQ_5ec10f972b1fa4f1e60d66d28bc') || message.includes('sku')) {
        userMessage = 'Inventory with this SKU already exists';
      }
      // Specific handling for product_id constraint
      else if (message.includes('product_id')) {
        userMessage = 'Inventory for this product already exists';
      }
      
      return new RpcException({
        statusCode: HttpStatus.CONFLICT,
        message: userMessage,
        error: 'Conflict',
        timestamp: new Date().toISOString(),
        details: {
          constraint: this.extractConstraintName(message),
          originalError: message
        }
      });
    }
    
    // Handle NOT NULL violations
    if (message.includes('null value in column') || exception.code === '23502') {
      return new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Required field is missing',
        error: 'Bad Request',
        timestamp: new Date().toISOString(),
      });
    }
    
    // Handle foreign key violations
    if (message.includes('foreign key constraint') || exception.code === '23503') {
      return new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Referenced record does not exist',
        error: 'Bad Request',
        timestamp: new Date().toISOString(),
      });
    }
    
    // Handle insufficient stock errors (business logic)
    if (message.includes('insufficient stock') || message.includes('not enough stock')) {
      return new RpcException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        message: 'Insufficient stock available',
        error: 'Unprocessable Entity',
        timestamp: new Date().toISOString(),
      });
    }
    
    // Default database error
    return new RpcException({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Database operation failed',
      error: 'Internal Server Error',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle validation errors
   */
  private handleValidationError(exception: any): RpcException {
    let message = 'Validation failed';
    
    if (Array.isArray(exception.message)) {
      message = exception.message.join(', ');
    } else if (exception.message) {
      message = exception.message;
    }
    
    return new RpcException({
      statusCode: HttpStatus.BAD_REQUEST,
      message: message,
      error: 'Bad Request',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Extract constraint name from error message
   */
  private extractConstraintName(message: string): string | null {
    const match = message.match(/\"([^\"]+)\"/);
    return match ? match[1] : null;
  }

  /**
   * Get error name based on HTTP status code
   */
  private getErrorName(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'Bad Request';
      case HttpStatus.UNAUTHORIZED:
        return 'Unauthorized';
      case HttpStatus.FORBIDDEN:
        return 'Forbidden';
      case HttpStatus.NOT_FOUND:
        return 'Not Found';
      case HttpStatus.CONFLICT:
        return 'Conflict';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'Unprocessable Entity';
      case HttpStatus.INTERNAL_SERVER_ERROR:
        return 'Internal Server Error';
      default:
        return 'Error';
    }
  }
}
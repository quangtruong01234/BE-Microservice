import {
  Controller,
  Post,
  Body,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  Request,
  Res,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { Response } from "express";
import { UserService } from "./user.service";
import {
  RegisterUserDto,
  LoginUserDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  ListUsersQueryDto,
  FeaturedSellersQueryDto,
  UpdateUserGatewayDto,
} from "./dto/user.dto";
import {
  CreateUserAddressDto,
  UpdateUserAddressDto,
} from "./dto/user-address.dto";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import {
  AUTH_COOKIE_NAME,
  getAuthCookieOptions,
  getClearAuthCookieOptions,
  REMEMBER_ME_AUTH_COOKIE_MAX_AGE_MS,
} from "../common/auth-cookie";
import { AUTH_MESSAGE } from "libs/constant/response-message.constant";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";
import { ParsePublicIdPipe } from "../common/pipes/parse-public-id.pipe";

@ApiTags("User")
@ApiBearerAuth("bearer")
@Controller("user")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post("register")
  @Public()
  @RateLimit({ limit: 10, ttl: 60 })
  @ApiOperation({ summary: "Register new user" })
  @ApiBody({ type: RegisterUserDto })
  @ApiResponse({ status: 201, description: "User registered successfully." })
  @ApiResponse({ status: 400, description: "Bad Request." })
  async register(@Body() dto: RegisterUserDto) {
    return await this.userService.register(dto);
  }

  @Post("login")
  @Public()
  @RateLimit({ limit: 10, ttl: 60 })
  @ApiOperation({ summary: "Login user — sets HttpOnly access_token cookie" })
  @ApiBody({ type: LoginUserDto })
  @ApiResponse({ status: 200, description: "Login successful." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async login(
    @Body() dto: LoginUserDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, unknown>> {
    const { user, token } = await this.userService.login(dto);
    const cookieOptions =
      dto.rememberMe === true
        ? getAuthCookieOptions(REMEMBER_ME_AUTH_COOKIE_MAX_AGE_MS)
        : getAuthCookieOptions();
    res.cookie(AUTH_COOKIE_NAME, token, cookieOptions);
    return user;
  }

  @Post("forgot-password")
  @Public()
  @RateLimit({ limit: 5, ttl: 60 })
  @ApiOperation({
    summary:
      "Request a password-reset verification code (sent to the registered email)",
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({
    status: 201,
    description:
      "Generic acknowledgement (does not reveal whether the email exists).",
  })
  @ApiResponse({ status: 400, description: "Bad Request." })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return await this.userService.forgotPassword(dto);
  }

  @Post("reset-password")
  @Public()
  @RateLimit({ limit: 10, ttl: 60 })
  @ApiOperation({
    summary: "Reset the password using the emailed verification code",
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 201, description: "Password updated." })
  @ApiResponse({
    status: 400,
    description: "Invalid or expired verification code.",
  })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return await this.userService.resetPassword(dto);
  }

  @Post("change-password")
  @UseGuards(JwtAuthGuard)
  @RateLimit({ limit: 5, ttl: 60 })
  @ApiOperation({
    summary:
      "Change the current user's password (knows the old one — no email code)",
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ status: 201, description: "Password updated." })
  @ApiResponse({
    status: 400,
    description:
      "newPassword is shorter than 6 characters or equal to currentPassword.",
  })
  @ApiResponse({
    status: 401,
    description:
      "currentPassword is wrong (NOT an expired session — the cookie stays valid).",
  })
  @ApiResponse({ status: 429, description: "Too many attempts." })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Request() req: { user: { id: number } },
  ) {
    return this.userService.changePassword(req.user.id, dto);
  }

  @Post("logout")
  @Public()
  @ApiOperation({ summary: "Logout — clears access_token cookie" })
  @ApiResponse({ status: 200, description: "Logged out." })
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE_NAME, getClearAuthCookieOptions());
    return { message: AUTH_MESSAGE.LOGOUT_SUCCESS };
  }

  @Get()
  @Roles("admin")
  @ApiOperation({ summary: "Get paginated users (admin only)" })
  @ApiResponse({ status: 200, description: "Paginated user list." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  async getUsersPaginated(@Query(ValidationPipe) query: ListUsersQueryDto) {
    return await this.userService.getUsersPaginated(
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Get("featured-sellers")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Get featured sellers (any authenticated user)",
  })
  @ApiResponse({
    status: 200,
    description: "Array of featured shop accounts (public profile fields).",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async getFeaturedSellers(
    @Query(ValidationPipe) query: FeaturedSellersQueryDto,
  ) {
    return this.userService.getFeaturedSellers(query.limit ?? 5);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get current authenticated user" })
  @ApiResponse({ status: 200, description: "Current user profile." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async getMe(@Request() req: { user: { id: number } }) {
    return this.userService.getMe(req.user.id);
  }

  @Get("me/addresses")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "List the current user's saved shipping addresses" })
  @ApiResponse({ status: 200, description: "Array of saved addresses." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async listAddresses(@Request() req: { user: { id: number } }) {
    return this.userService.listAddresses(req.user.id);
  }

  @Post("me/addresses")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Add a shipping address for the current user" })
  @ApiBody({ type: CreateUserAddressDto })
  @ApiResponse({ status: 201, description: "Created address." })
  @ApiResponse({ status: 400, description: "Bad Request." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async createAddress(
    @Body() dto: CreateUserAddressDto,
    @Request() req: { user: { id: number } },
  ) {
    return this.userService.createAddress(req.user.id, dto);
  }

  @Patch("me/addresses/:addressId")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Update one of the current user's addresses" })
  @ApiBody({ type: UpdateUserAddressDto })
  @ApiResponse({ status: 200, description: "Updated address." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 404, description: "Address not found." })
  async updateAddress(
    @Param("addressId", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.ADDRESS))
    addressId: string,
    @Body() dto: UpdateUserAddressDto,
    @Request() req: { user: { id: number } },
  ) {
    return this.userService.updateAddress(req.user.id, addressId, dto);
  }

  @Patch("me/addresses/:addressId/default")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Set one of the current user's addresses as default",
  })
  @ApiResponse({ status: 200, description: "The new default address." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 404, description: "Address not found." })
  async setDefaultAddress(
    @Param("addressId", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.ADDRESS))
    addressId: string,
    @Request() req: { user: { id: number } },
  ) {
    return this.userService.setDefaultAddress(req.user.id, addressId);
  }

  @Delete("me/addresses/:addressId")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Delete one of the current user's addresses" })
  @ApiResponse({ status: 200, description: "Deletion result." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 404, description: "Address not found." })
  async deleteAddress(
    @Param("addressId", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.ADDRESS))
    addressId: string,
    @Request() req: { user: { id: number } },
  ) {
    return this.userService.deleteAddress(req.user.id, addressId);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get user info by public id (usr_...)" })
  @ApiResponse({ status: 200, description: "User info." })
  @ApiResponse({ status: 400, description: "Invalid user id format." })
  @ApiResponse({ status: 404, description: "User not found." })
  async getUserInfo(
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.USER)) id: string,
  ) {
    return await this.userService.getUserInfo(id);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Update user profile (own account only)" })
  @ApiBody({ type: UpdateUserGatewayDto })
  @ApiResponse({ status: 200, description: "Updated user profile." })
  @ApiResponse({ status: 400, description: "Invalid user id format." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "User not found." })
  async updateUser(
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.USER)) id: string,
    @Body() dto: UpdateUserGatewayDto,
    @Request() req: { user: { id: number } },
  ) {
    return this.userService.updateUser(req.user.id, id, dto);
  }
}

import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Patch,
  ParseIntPipe,
  Request,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { UserService } from "./user.service";
import {
  RegisterUserDto,
  LoginUserDto,
  UpdateUserGatewayDto,
} from "./dto/user.dto";
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

const COOKIE_NAME = "access_token";
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 5 * 60 * 60 * 1000, // 5 hours in ms
  path: "/",
};

@ApiTags("User")
@ApiBearerAuth("bearer")
@Controller("user")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post("register")
  @Public()
  @ApiOperation({ summary: "Register new user" })
  @ApiBody({ type: RegisterUserDto })
  @ApiResponse({ status: 201, description: "User registered successfully." })
  @ApiResponse({ status: 400, description: "Bad Request." })
  async register(@Body() dto: RegisterUserDto) {
    return await this.userService.register(dto);
  }

  @Post("login")
  @Public()
  @ApiOperation({ summary: "Login user — sets HttpOnly access_token cookie" })
  @ApiBody({ type: LoginUserDto })
  @ApiResponse({ status: 200, description: "Login successful." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async login(
    @Body() dto: LoginUserDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, unknown>> {
    const { user, token } = await this.userService.login(dto);
    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
    const safeUser: Record<string, unknown> = { ...user };
    delete safeUser["password"];
    return safeUser;
  }

  @Post("logout")
  @Public()
  @ApiOperation({ summary: "Logout — clears access_token cookie" })
  @ApiResponse({ status: 200, description: "Logged out." })
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    return { message: "Logged out successfully" };
  }

  @Get("all")
  @Roles("admin")
  @ApiOperation({ summary: "Get all users" })
  @ApiResponse({ status: 200, description: "List all users." })
  async getAllUsers() {
    return await this.userService.getAllUsers();
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get current authenticated user" })
  @ApiResponse({ status: 200, description: "Current user profile." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async getMe(@Request() req: { user: { id: number } }) {
    return this.userService.getMe(req.user.id);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get user info by id" })
  @ApiResponse({ status: 200, description: "User info." })
  @ApiResponse({ status: 404, description: "User not found." })
  async getUserInfo(@Param("id") id: number) {
    return await this.userService.getUserInfo(id);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Update user profile (own account only)" })
  @ApiBody({ type: UpdateUserGatewayDto })
  @ApiResponse({ status: 200, description: "Updated user profile." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "User not found." })
  async updateUser(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateUserGatewayDto,
    @Request() req: { user: { id: number } },
  ) {
    return this.userService.updateUser(req.user.id, id, dto);
  }
}

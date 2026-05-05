import { Controller, Post, Body, Get, Param } from "@nestjs/common";
import { UserService } from "./user.service";
import { RegisterUserDto, LoginUserDto } from "./dto/user.dto";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";

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
  @ApiOperation({ summary: "Login user" })
  @ApiBody({ type: LoginUserDto })
  @ApiResponse({ status: 200, description: "Login successful." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async login(@Body() dto: LoginUserDto) {
    return await this.userService.login(dto);
  }
  @Get("all")
  @Roles("admin")
  @ApiOperation({ summary: "Get all users" })
  @ApiResponse({ status: 200, description: "List all users." })
  async getAllUsers() {
    return await this.userService.getAllUsers();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get user info by id" })
  @ApiResponse({ status: 200, description: "User info." })
  @ApiResponse({ status: 404, description: "User not found." })
  async getUserInfo(@Param("id") id: number) {
    return await this.userService.getUserInfo(id);
  }
}

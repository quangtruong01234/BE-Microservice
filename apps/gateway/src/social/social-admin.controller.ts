import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { Request } from "express";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CheckPermission } from "../common/decorators/check-permission.decorator";
import { SocialGatewayService } from "./social.service";
import { ReportedPostsQueryDto } from "./dto/reported-posts-query.dto";

@ApiTags("Social Moderation")
@ApiBearerAuth("bearer")
@Controller("social/admin")
export class SocialAdminController {
  constructor(private readonly socialService: SocialGatewayService) {}

  @Get("reports")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("post", "read:any")
  @ApiOperation({
    summary: "Admin: list reported posts grouped by post (paginated)",
  })
  @ApiResponse({ status: 200, description: "Paginated reported-post queue." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden — admin only." })
  async listReportedPosts(
    @Query(ValidationPipe) query: ReportedPostsQueryDto,
  ): Promise<unknown> {
    return this.socialService.listReportedPosts(
      query.status ?? "pending",
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Post("posts/:id/hide")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("post", "update:any")
  @ApiOperation({
    summary: "Admin: hide a post from feeds and resolve its pending reports",
  })
  @ApiResponse({ status: 201, description: "Post hidden." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Post not found." })
  async hidePost(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<unknown> {
    const adminId = req.user?.id ?? 0;
    return this.socialService.hidePost(id, adminId);
  }

  @Post("posts/:id/unhide")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("post", "update:any")
  @ApiOperation({ summary: "Admin: restore a hidden post to feeds" })
  @ApiResponse({ status: 201, description: "Post unhidden." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Post not found." })
  async unhidePost(@Param("id", ParseIntPipe) id: number): Promise<unknown> {
    return this.socialService.unhidePost(id);
  }

  @Post("posts/:id/dismiss")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("post", "update:any")
  @ApiOperation({
    summary: "Admin: dismiss a post's pending reports (post stays visible)",
  })
  @ApiResponse({ status: 201, description: "Reports dismissed." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Post not found." })
  async dismissReports(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<unknown> {
    const adminId = req.user?.id ?? 0;
    return this.socialService.dismissReports(id, adminId);
  }

  @Delete("posts/:id")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("post", "delete:any")
  @ApiOperation({
    summary: "Admin: permanently delete any post and its report rows",
  })
  @ApiResponse({ status: 200, description: "Post deleted." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Post not found." })
  async adminDeletePost(
    @Param("id", ParseIntPipe) id: number,
  ): Promise<unknown> {
    return this.socialService.adminDeletePost(id);
  }
}

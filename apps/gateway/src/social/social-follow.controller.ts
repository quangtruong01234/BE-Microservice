import {
  Controller,
  Delete,
  Get,
  Param,
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
import { SocialGatewayService } from "./social.service";
import { GetPostsQueryDto } from "./dto/get-posts-query.dto";
import { OptionalJwtAuthGuard } from "../common/guards/optional-jwt-auth.guard";
import { Public } from "../common/decorators/public.decorator";
import { ParsePublicIdPipe } from "../common/pipes/parse-public-id.pipe";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";

@ApiTags("Social")
@Controller("social/users")
export class SocialFollowController {
  constructor(private readonly socialService: SocialGatewayService) {}

  @Post(":id/follow")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Follow a user" })
  @ApiResponse({ status: 201, description: "Followed." })
  @ApiResponse({ status: 400, description: "Cannot follow yourself." })
  @ApiResponse({ status: 409, description: "Already following." })
  async followUser(
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.USER))
    followingId: string,
    @Req() req: Request,
  ): Promise<unknown> {
    const followerId = req.user?.id ?? 0;
    return this.socialService.followUser(followerId, followingId);
  }

  @Delete(":id/follow")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Unfollow a user" })
  @ApiResponse({ status: 200, description: "Unfollowed." })
  @ApiResponse({ status: 404, description: "Follow relationship not found." })
  async unfollowUser(
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.USER))
    followingId: string,
    @Req() req: Request,
  ): Promise<unknown> {
    const followerId = req.user?.id ?? 0;
    return this.socialService.unfollowUser(followerId, followingId);
  }

  @Get(":id/followers")
  @Public()
  @ApiOperation({ summary: "Get followers of a user" })
  @ApiResponse({ status: 200, description: "Paginated follower list." })
  async getFollowers(
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.USER)) userId: string,
    @Query(ValidationPipe) query: GetPostsQueryDto,
  ): Promise<unknown> {
    return this.socialService.getFollowers(
      userId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Get(":id/following")
  @Public()
  @ApiOperation({ summary: "Get users that a user is following" })
  @ApiResponse({ status: 200, description: "Paginated following list." })
  async getFollowing(
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.USER)) userId: string,
    @Query(ValidationPipe) query: GetPostsQueryDto,
  ): Promise<unknown> {
    return this.socialService.getFollowing(
      userId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Get(":id/feed")
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: "Get feed of posts from users that a user follows" })
  @ApiResponse({ status: 200, description: "Paginated following feed." })
  async getFollowingFeed(
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.USER)) userId: string,
    @Req() req: Request,
    @Query(ValidationPipe) query: GetPostsQueryDto,
  ): Promise<unknown> {
    const viewerUserId = req.user?.id ?? null;
    return this.socialService.getFollowingFeed(
      userId,
      query.page ?? 1,
      query.limit ?? 20,
      viewerUserId,
    );
  }
}

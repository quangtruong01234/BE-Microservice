import { Test, TestingModule } from '@nestjs/testing';
import { RewardsController } from './rewards.controller';
import { RewardsService } from './rewards.service';

describe('RewardsController', () => {
  let rewardsController: RewardsController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [RewardsController],
      providers: [RewardsService],
    }).compile();

    rewardsController = app.get<RewardsController>(RewardsController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(rewardsController.getHello()).toBe('Hello World!');
    });
  });
});

#import "VrtCapture.h"

#import <React/RCTComponentViewProtocol.h>
#import <UIKit/UIKit.h>

@implementation VrtCapture

+ (NSString *)moduleName
{
  return @"VrtCapture";
}

static BOOL VrtIsReactView(UIView *view)
{
  return [view conformsToProtocol:@protocol(RCTComponentViewProtocol)];
}

static UIView *VrtFindView(UIView *root, NSInteger reactTag)
{
  if (root.tag == reactTag && VrtIsReactView(root)) {
    return root;
  }
  for (UIView *child in root.subviews) {
    UIView *found = VrtFindView(child, reactTag);
    if (found) {
      return found;
    }
  }
  return nil;
}

static UIView *VrtFindMountedView(NSInteger reactTag)
{
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:UIWindowScene.class]) {
      continue;
    }
    for (UIWindow *window in ((UIWindowScene *)scene).windows) {
      UIView *found = VrtFindView(window, reactTag);
      if (found) {
        return found;
      }
    }
  }
  return nil;
}

- (void)capture:(double)reactTag resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSInteger tag = (NSInteger)reactTag;
  dispatch_async(dispatch_get_main_queue(), ^{
    UIView *view = VrtFindMountedView(tag);
    if (!view || !view.window) {
      reject(@"E_VIEW", [NSString stringWithFormat:@"VRT target view %ld is not mounted in a window", (long)tag], nil);
      return;
    }
    if (CGRectIsEmpty(view.bounds)) {
      reject(@"E_SIZE", @"VRT target view has zero size", nil);
      return;
    }

    // Force 8-bit sRGB output so that wide color devices produce the same pixels as other simulators.
    UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat formatForTraitCollection:view.traitCollection];
    format.preferredRange = UIGraphicsImageRendererFormatRangeStandard;
    format.opaque = NO;
    UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithBounds:view.bounds format:format];

    __block BOOL drew = NO;
    UIImage *image = [renderer imageWithActions:^(__unused UIGraphicsImageRendererContext *context) {
      drew = [view drawViewHierarchyInRect:view.bounds afterScreenUpdates:YES];
    }];
    if (!drew) {
      reject(@"E_DRAW", @"VRT failed to draw the view hierarchy", nil);
      return;
    }

    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      NSData *png = UIImagePNGRepresentation(image);
      if (!png) {
        reject(@"E_PNG", @"VRT failed to encode PNG", nil);
        return;
      }
      resolve([png base64EncodedStringWithOptions:0]);
    });
  });
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeVrtCaptureSpecJSI>(params);
}

@end

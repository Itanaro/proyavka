# Inference-only settings of BiRefNet (swin_v1_l, General / HR), trimmed from the original config.py (MIT, ZhengPeng7/BiRefNet).
import os
class Config:
    def __init__(self):
        self.batch_size = int(os.environ.get('BIREFNET_BS', '4'))   # >1 → BatchNorm layers exist (they are in the published weights)
        self.SDPA_enabled = True
        self.ms_supervision = True
        self.out_ref = True
        self.dec_ipt = True
        self.dec_ipt_split = True
        self.cxt_num = 3
        self.mul_scl_ipt = 'cat'
        self.dec_att = 'ASPPDeformable'
        self.squeeze_block = 'BasicDecBlk_x1'
        self.dec_blk = 'BasicDecBlk'
        self.bb = 'swin_v1_l'
        self.freeze_bb = False
        self.lateral_channels_in_collection = [c * 2 for c in (1536, 768, 384, 192)]
        self.cxt = self.lateral_channels_in_collection[1:][::-1][-self.cxt_num:]
        self.lat_blk = 'BasicLatBlk'
        self.dec_channels_inter = 'fixed'
        self.auxiliary_classification = False
        self.weights = {}

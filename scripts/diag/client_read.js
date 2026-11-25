// 用客户端原生 reading 解析, 检查字段值
(function(){
    var V = window.__DLDL_VSERVER__;
    var ser = V.buildLoginDetail(V.save);
    var ByteArray = Laya.__classmap['com.common.connect.structure.ByteArray'];
    var DetailCls = Laya.__classmap['com.protocol.login.ResLoginPlayerDetailInfo'];
    var msg = new DetailCls();
    var ba = new ByteArray();
    for (var i=0;i<ser.bytes.length;i++) ba.writeByte(ser.bytes[i]&0xff);
    for (var p2=0;p2<64;p2++) ba.writeByte(0);   // 64字节0填充
    ba.position = 0; ba._position_ = 0;
    var result = {};
    // 记录读取位置序列
    var posSeq = [];
    var origRB = ByteArray.prototype.readByte;
    ByteArray.prototype.readByte = function(){
        var r = origRB.apply(this, arguments);
        posSeq.push(this._position_);
        return r;
    };
    try {
        msg.read(ba);
        result.status = 'READ_OK';
        // 检查关键字段
        var checks = ['spiderArmorBagInfo','artifactBagInfo','dragonDanBagInfo','goods','equips','teamPartnerIds','newcomerGuideIDs','fateAttribute','tinyMailsInfo','TrinityBagInfo','legionShowVo','list'];
        var fieldVals = {};
        checks.forEach(function(f){
            var v = msg[f];
            fieldVals[f] = (v === null) ? 'null' : (Array.isArray(v) ? 'arr['+v.length+']' : (typeof v === 'object' ? Object.keys(v||{}).length+'keys' : String(v)));
        });
        result.fields = fieldVals;
        result.bagNonEmpty = [];
        ['magicHerbBag','hunheBag','allianceBooksBag','spirtBooksBag','relevanceBagInfo','superWeaponCoreBag','soulWeaponCoreBag','soulMonBag','fightArmorBagInfo','manaBagInfo','sacredBagInfo','newDragonSoulBagInfo','spiderArmorBagInfo','artifactBagInfo','dragonDanBagInfo','dragonKnightBagInfo','soulCardBagInfo','angleRuneBagInfo','originBagInfo','legendSoulCardBagInfo','shenXinBagInfo','costumeBagInfo','maxGodBagInfo','holySpellGodBagInfo','dkCostumeBagInfo','StarArmorBagInfo','StarArmorModuleBagInfo','CubeBagInfo','GodTableBagInfo','ZhenArmsBagInfo','ZhenArmsModuleBagInfo','GougeBagInfo','BitplanesRelicBagInfo','BeastDeityCoreBagInfo','BeastDeityCoreModuleBagInfo','SuperJewelBagInfo','SuperJewelModuleBagInfo','spiritSeaBagInfo','TrinityBagInfo','KeelBagInfo','KeelModuleBagInfo'].forEach(function(f){
            var v = msg[f];
            if (v && Object.keys(v).length > 0) result.bagNonEmpty.push(f + ':' + Object.keys(v).length);
        });
    } catch(e) {
        result.status = 'ERR: ' + e.message;
        result.posSeq = posSeq;
        result.firstDiverge = -1;
        // 抓部分解析的字段
        var partial = {};
        try {
            for (var k in msg) {
                if (!msg.hasOwnProperty(k) && typeof msg[k] !== 'function') continue;
                var v = msg[k];
                if (typeof v === 'function') continue;
                partial[k] = (v === null) ? 'null' : (Array.isArray(v) ? 'arr['+v.length+']' : (typeof v === 'object' ? (Object.keys(v||{}).length + 'keys') : String(v).substring(0,8)));
            }
        } catch(e2) {}
        result.partial = partial;
    }
    ByteArray.prototype.readByte = origRB;
    window.__client_read = result;
    window.__posseq = posSeq;
})();

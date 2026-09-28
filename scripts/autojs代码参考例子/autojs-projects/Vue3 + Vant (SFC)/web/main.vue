<template>
    <van-nav-bar title="基于 Vue 3 的界面"/>

    <van-tabs v-model:active="activeTab">
        <van-tab title="配置">
            <van-cell-group title="权限">
                <van-cell title="无障碍服务" label="用于脚本自动操作 (点击/长按/滑动等)">
                    <van-switch
                        v-model="accessibilityServiceEnabled"
                        @update:model-value="onAccessibilityServiceCheckChanged"
                    />
                </van-cell>
            </van-cell-group>
            <van-cell-group title="配置">
                <van-cell title="开关样本">
                    <van-switch
                        v-model="sampleSwitchChecked"
                        @update:model-value="onSampleSwitchChanged"
                    />
                </van-cell>
                <van-field v-model="greeting"
                           label="问候语"
                           placeholder="请输入问候语"
                           maxlength="20"
                           input-align="right"
                />
                <van-field v-model.number="count"
                           label="运行次数"
                           placeholder="请输入运行次数"
                           maxlength="4"
                           type="number"
                           input-align="right"
                />
                <van-field
                    :model-value="selectedFilePath"
                    label="选择文件"
                    placeholder="选择一个文件"
                    readonly
                    is-link
                    @click="selectFile"
                    input-align="right"
                />
            </van-cell-group>
        </van-tab>

        <van-tab title="运行">
            <van-cell title="查看日志" is-link @click="showLog"/>
            <div style="margin: 16px 16px 0; text-align: center;">
                <van-button type="primary" @click="run">运行</van-button>
            </div>
        </van-tab>

        <van-tab title="关于">
            <van-cell
                :title="'运行环境: AutoJs6 ' + (appVersionName || '')"
                label="WebView + Android"
                is-link
                @click="showDeviceInfoDialog"
            />
            <van-cell
                :title="'Vue.js ' + vueVersion"
                label="渐进式 JavaScript 框架"
                is-link
                @click="openVueWebsite"
            />
            <van-cell
                :title="'Vant ' + vantVersion"
                label="轻量, 可靠的移动端 Vue 3 组件库"
                is-link
                @click="openVantWebsite"
            />
            <van-cell
                title="设备信息（invoke 返回值）"
                :label="deviceInfoLabel"
                is-link
                @click="loadDeviceInfo"
            />
        </van-tab>
    </van-tabs>
</template>
<script>
import { ref } from 'vue';

export default {
    setup() {
        // Vue 3 Composition API：状态用 ref，方法用普通函数（对应 Vue2 例子的 data/methods）
        const accessibilityServiceEnabled = ref(false);
        const activeTab = ref(0);
        const sampleSwitchChecked = ref(true);
        const greeting = ref('Hello');
        const count = ref(192);
        const appVersionName = ref('');
        const selectedFilePath = ref('');
        const vueVersion = ref(Vue.version || '');
        const vantVersion = ref(vant.version || '');
        const deviceInfoLabel = ref('点击获取');

        // ---- 与安卓交互（$autojs 由 autojs://sdk/v1.js 注入，与 Vue 版本无关）----
        function onAccessibilityServiceCheckChanged(checked) {
            $autojs.invoke('set-accessibility-enabled', checked);
        }
        function onSampleSwitchChanged(checked) {
            $autojs.invoke('toast-log', `样本开关已${checked ? '开启' : '关闭'}`);
        }
        function showLog() {
            $autojs.invoke('show-log');
        }
        function openVantWebsite() {
            $autojs.send('open-url', 'https://vant-ui.github.io/vant/#/zh-CN/');
        }
        function openVueWebsite() {
            $autojs.send('open-url', 'https://cn.vuejs.org/');
        }
        function run() {
            $autojs.invoke('toast-log', `greeting: "${greeting.value}"\ncount: ${count.value}`);
        }
        function selectFile() {
            $autojs.invoke('select-file', '*/*').then((path) => {
                selectedFilePath.value = path || '';
            });
        }
        function showDeviceInfoDialog() {
            $autojs.invoke('show-device-info-dialog');
        }
        function loadDeviceInfo() {
            $autojs.invoke('get-device-info').then((info) => {
                deviceInfoLabel.value = `${info.brand} ${info.model} · Android ${info.release} (SDK ${info.sdk}) · ${info.screen}`;
            });
        }

        // 初始化时读取安卓侧状态
        $autojs.invoke('get-accessibility-enabled').then((value) => {
            accessibilityServiceEnabled.value = value;
        });
        $autojs.invoke('get-app-version-name').then((value) => {
            appVersionName.value = value;
        });

        return {
            accessibilityServiceEnabled, activeTab, sampleSwitchChecked,
            greeting, count, appVersionName, selectedFilePath,
            vueVersion, vantVersion, deviceInfoLabel,
            onAccessibilityServiceCheckChanged, onSampleSwitchChanged,
            showLog, openVantWebsite, openVueWebsite, run, selectFile,
            showDeviceInfoDialog, loadDeviceInfo,
        };
    },
};
</script>

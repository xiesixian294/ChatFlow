<template>
  <div class="auth-page">
    <div class="auth-bg auth-bg-a"></div>
    <div class="auth-bg auth-bg-b"></div>
    <div class="auth-mask"></div>
    <el-card class="login-card glass-card login-el-card" shadow="never">
      <div class="login-kicker">HFUT AI Hub</div>
      <h1>{{ isRegisterMode ? "学生注册" : "学生登录" }}</h1>
      <p class="muted">
        {{
          isRegisterMode
            ? "先完成学生注册，再使用学号登录进入校园 AI 门户。"
            : "使用学号登录，系统会自动隔离你的历史会话与聊天记录。"
        }}
      </p>

      <div class="role-tabs">
        <el-button class="tab" round :type="isRegisterMode ? 'default' : 'danger'"
          :class="{ active: !isRegisterMode, ghost: isRegisterMode }" @click="switchMode('login')">
          学生登录
        </el-button>
        <el-button class="tab" round :type="isRegisterMode ? 'danger' : 'default'"
          :class="{ active: isRegisterMode, ghost: !isRegisterMode }" @click="switchMode('register')">
          学生注册
        </el-button>
      </div>

      <el-form ref="formRef" class="auth-form" :model="form" :rules="rules" label-position="top" status-icon
        @submit.prevent="handleSubmit">
        <el-form-item class="field" label="学号" prop="studentId">
          <el-input v-model="form.studentId" size="large" placeholder="请输入学号" />
        </el-form-item>

        <el-form-item v-if="isRegisterMode" class="field" label="姓名" prop="name">
          <el-input v-model="form.name" size="large" placeholder="请输入真实姓名" />
        </el-form-item>

        <el-form-item class="field" label="密码" prop="password">
          <el-input v-model="form.password" size="large" type="password" show-password placeholder="请输入密码" />
        </el-form-item>

        <el-form-item class="submit-item">
          <!-- native-type="submit"属性的意思是，当点击按钮的时候，会触发表单的默认提交行为 -->
          <el-button class="login-submit" type="danger" native-type="submit" size="large" :loading="loading">
            {{
              loading
                ? isRegisterMode
                  ? "注册中..."
                  : "登录中..."
                : isRegisterMode
                  ? "注册"
                  : "登录"
            }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
  import { computed, reactive, ref } from "vue";
  import { useRoute, useRouter } from "vue-router";
  import { ElMessage } from "element-plus";
  import { login, registerStudent, saveAuth } from "../api";

  const route = useRoute();
  const router = useRouter();
  const formRef = ref();
  const loading = ref(false);
  const mode = ref("login");
  const form = reactive({
    studentId: "20240001",
    password: "123456",
    name: "HFUT学生",
  });
  //判断是否为注册模式
  const isRegisterMode = computed(() => mode.value === "register");
  //表单验证规则
  const rules = computed(() => ({
    studentId: [
      { required: true, message: "请输入学号", trigger: "blur" },
      { min: 4, max: 20, message: "学号长度需在 4-20 个字符之间", trigger: "blur" },
    ],
    //在注册模式下，姓名字段必填登录模式则不需要验证
    name: isRegisterMode.value
      ? [
        { required: true, message: "请输入姓名", trigger: "blur" },
        { min: 2, max: 128, message: "姓名长度需在 2-128 个字符之间", trigger: "blur" },
      ]
      : [],
    password: [
      { required: true, message: "请输入密码", trigger: "blur" },
      { min: 6, max: 64, message: "密码长度需在 6-64 个字符之间", trigger: "blur" },
    ],
  }));

  //切换登录、注册模式
  //点击会触发切换模式函数，并把当前是什么状态传入nextMode
  function switchMode(nextMode) {
    mode.value = nextMode;
    //同时，如果切换了模式，要清空表单验证状态
    formRef.value?.clearValidate();
  }

  //提交表单
  //整整的提交函数，点击提交的时候会执行这个函数
  async function handleSubmit() {
    const valid = await formRef.value?.validate().catch(() => false);
    if (!valid) {
      ElMessage.warning(isRegisterMode.value ? "请完善注册表单信息" : "请完善登录表单信息");
      return;
    }

    loading.value = true;
    try {
      if (isRegisterMode.value) {
        //如果当前是注册模式，则调用注册接口
        await registerStudent(form);
        ElMessage.success("注册成功，请使用新账号登录");
        mode.value = "login";
        return;
      }
      //如果当前是登录模式，则调用登录接口
      const result = await login(form);
      saveAuth(result.token, result.user);
      ElMessage.success("登录成功");
      //登录成功后重定向
      //如果当前路由的query有重定向参数，就使用重定向参数，否则使用/home
      const redirect =
        typeof route.query.redirect === "string" ? route.query.redirect : "/home";
      //重定向到指定路由
      router.push(redirect);
    } catch (error) {
      //如果错误信息包含用户不存在，则提示用户不存在，并切换到注册模式
      if (error.message.includes("用户不存在")) {
        ElMessage.warning("用户不存在，请先注册");
        //切换到注册模式
        mode.value = "register";
        return;
      }
      //否则就说明登录失败，提示错误信息
      ElMessage.error(error.message || (isRegisterMode.value ? "注册失败" : "登录失败"));
    } finally {
      //无论成功还是失败，都要将loading状态设置为false
      loading.value = false;
    }
  }
</script>

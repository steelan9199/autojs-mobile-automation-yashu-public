"ui";
importClass(android.view.View.OnFocusChangeListener);
importClass(android.text.TextWatcher)
importClass(java.lang.Runnable);
importClass(android.animation.ObjectAnimator)
importClass(android.animation.PropertyValuesHolder)
importClass(android.animation.ValueAnimator)
importClass(android.animation.AnimatorSet)
importClass(android.view.animation.AccelerateInterpolator)
importClass(android.view.animation.TranslateAnimation)
importClass(android.animation.TimeInterpolator)
importClass(android.content.Context);
importClass(android.os.Bundle)
importClass(android.view.View)
importClass(android.view.Window)
importClass(android.view.WindowManager)
importClass(android.view.animation.AccelerateDecelerateInterpolator)
importClass(android.view.animation.AnticipateInterpolator)
importClass(android.view.animation.AnticipateOvershootInterpolator)
importClass(android.view.animation.BounceInterpolator)
importClass(android.view.animation.CycleInterpolator)
importClass(android.view.animation.DecelerateInterpolator)
importClass(android.view.animation.LinearInterpolator)
importClass(android.view.animation.OvershootInterpolator)
importClass(android.view.animation.PathInterpolator)
importClass(android.widget.Button)
importClass(android.widget.ImageView)
importClass(android.widget.TextView)
var UserInput = (function() {
    importClass(android.widget.EditText);
    //继承ui.Widget
    util.extend(UserInput, ui.Widget);

    function UserInput() {
        //调用父类构造函数
        ui.Widget.call(this);
        this.defineAttr("width", function(view, name, value, defaultGetter) {
            view.UserInput_Base.attr("width", value);
        })
        this.defineAttr("textColor", function(view, name, value, defaultGetter) {
            view.UserInput_HintDeputy.setTextColor(colors.parseColor(value));
            view.UserInput_InputText.setTextColor(colors.parseColor(value));
            view.UserInput_IineDeputy.attr("bg", value);
        })
        this.defineAttr("inputType", function(view, name, value, defaultGetter) {
            view.UserInput_InputText.setInputType(value);
        })
        this.defineAttr("hintText", function(view, name, value, defaultGetter) {
            view.UserInput_Hint.setText(value);
            view.UserInput_HintDeputy.setText(value);
        })
        this.defineAttr("themeColor", function(view, name, value, defaultGetter) {
            view.UserInput_Hint.setTextColor(colors.parseColor(value));
            view.UserInput_ErrorHint.setTextColor(colors.parseColor(value));
            view.UserInput_Iine.attr("bg", value);
        })
        this.defineAttr("start", function(view, name, value, defaultGetter) {
            let that = view,
                thatView = that.UserInput_InputText;
            // 焦点状态存到控件实例字段，避免裸全局变量被多个控件实例互相串扰
            that._focused = false;
            thatView.setOnFocusChangeListener(new View.OnFocusChangeListener({
                onFocusChange: function(view, hasFocus) {
                    if (hasFocus) {
                        let animatorSetPeople = new AnimatorSet();
                        animatorSetPeople.setDuration(500);
                        let translationY_1 = ObjectAnimator.ofFloat(that.UserInput_TitleBase, "translationY", 0, -75);
                        let translationY_2 = ObjectAnimator.ofFloat(that.UserInput_HintDeputy, "translationY", 0, -75);
                        let scaleX = ObjectAnimator.ofFloat(that.UserInput_Iine, "scaleX", 0, 1);
                        let alpha = ObjectAnimator.ofFloat(that.UserInput_TitleBase, "alpha", 0, 1);
                        if (!that._focused) {
                            animatorSetPeople.play(translationY_1).with(translationY_2).with(scaleX).with(alpha);
                            that._focused = true;
                        } else {
                            animatorSetPeople.play(scaleX).with(alpha);
                        }
                        animatorSetPeople.start();
                    } else {
                        let animatorSetPeople = new AnimatorSet();
                        animatorSetPeople.setDuration(500);
                        let translationY_1 = ObjectAnimator.ofFloat(that.UserInput_TitleBase, "translationY", -75, 0);
                        let translationY_2 = ObjectAnimator.ofFloat(that.UserInput_HintDeputy, "translationY", -75, 0);
                        let scaleX = ObjectAnimator.ofFloat(that.UserInput_Iine, "scaleX", 1, 0);
                        let alpha = ObjectAnimator.ofFloat(that.UserInput_TitleBase, "alpha", 1, 0);
                        if (that._focused && that.UserInput_InputText.getText().length() == 0) {
                            animatorSetPeople.play(translationY_1).with(translationY_2).with(scaleX).with(alpha);
                            that._focused = false;
                        } else {
                            animatorSetPeople.play(scaleX).with(alpha);
                        }
                        animatorSetPeople.start();
                    }
                }
            }))
        })
    }
    UserInput.prototype.render = function() {
        return (
            <frame>
                            <frame h="150px" id="UserInput_Base" gravity="bottom">
                                <frame marginBottom="25px" layout_gravity="bottom" gravity="bottom">
                                    <text id="UserInput_HintDeputy" textSize="40px" text="User" textColor="#000000" gravity="bottom"/>
                                    <linear id="UserInput_TitleBase" orientation="horizontal" gravity="bottom" alpha="0">
                                        <text id="UserInput_Hint" textSize="40px" text="User" textColor="#9E9E9E"/>
                                        <text id="UserInput_ErrorHint" textSize="30px" textColor="#9E9E9E" alpha="0"/>
                                    </linear>
                                </frame>
                                <EditText id="UserInput_InputText" w="*" textSize="40px" textColor="#000000" lines="1" background="#00FFFFFF" gravity="bottom"/>
                                <frame marginBottom="15px" gravity="bottom|center_horizontal">
                                    <View id="UserInput_IineDeputy" w="*" h="4px" bg="#000000"/>
                                    <View id="UserInput_Iine" w="*" h="4px" bg="#9E9E9E" scaleX="0"/>
                                </frame>
                                <img id="UserInput_ErrorIcon" w="40px" h="40px" src="@drawable/ic_error_outline_black_48dp" tint="#FF8080" layout_gravity="top|right" alpha="0"/>
                            </frame>
                        </frame>
        )
    }
    UserInput.prototype.getInput = function() {
        return this.view.UserInput_InputText.getText();
    }
    // 显示错误态：标题 + 错误图标淡入；用户输入时自动淡出清除（监听器只注册一次，避免重复叠加）
    UserInput.prototype.setError = function(string) {
        let that = this.view,
            thatView = that.UserInput_InputText;
        that.UserInput_ErrorHint.setText("-" + string);
        that._errorVisible = true;
        let animatorSetPeople = new AnimatorSet(),
            alpha_1 = ObjectAnimator.ofFloat(that.UserInput_TitleBase, "alpha", 0, 1),
            alpha_2 = ObjectAnimator.ofFloat(that.UserInput_ErrorIcon, "alpha", 0, 1);
        animatorSetPeople.setDuration(500);
        animatorSetPeople.play(alpha_1).with(alpha_2);
        animatorSetPeople.start();   // 必须 start()，否则动画不执行（原文件漏掉的 bug）
        if (!that._errorWatcherAdded) {
            thatView.addTextChangedListener(new TextWatcher() {
                onTextChanged: function(CharSequence, start, before, count) {
                    if (that._errorVisible) {
                        that._errorVisible = false;
                        let animatorSetPeople = new AnimatorSet(),
                            alpha_1 = ObjectAnimator.ofFloat(that.UserInput_TitleBase, "alpha", 1, 0),
                            alpha_2 = ObjectAnimator.ofFloat(that.UserInput_ErrorIcon, "alpha", 1, 0);
                        animatorSetPeople.setDuration(500);
                        animatorSetPeople.play(alpha_1).with(alpha_2);
                        animatorSetPeople.start();
                    }
                }
            })
            that._errorWatcherAdded = true;
        }
    }
    ui.registerWidget("user-input", UserInput);
    return UserInput;
})();

ui.layout(
    <frame>
        <vertical>
            <user-input id="userInput" gravity="center" background="#20000000" width="500px" textColor="#80000000" inputType="3" hintText="User" themeColor="#2196F3" start=""/>
            <input layout_gravity="top" h="250px" maxLine="1" lines="1"/>
            <button id="Submit" text="提交"/>
        </vertical>
    </frame>
);
ui.Submit.on("click", function() {
    ui.userInput.widget.setError("未知错误")
})

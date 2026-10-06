Shader "AXYRO/ElenaPortrait"
{
    Properties
    {
        _MainTex ("Neutral", 2D) = "white" {}
        _SpeakTex ("Speaking", 2D) = "white" {}
        _BlinkTex ("Blink", 2D) = "white" {}
        _SpeechAmount ("Speech", Range(0, 1)) = 0
        _BlinkAmount ("Blink", Range(0, 1)) = 0
    }
    SubShader
    {
        Tags { "Queue" = "Transparent" "RenderType" = "Transparent" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Cull Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            sampler2D _MainTex;
            sampler2D _SpeakTex;
            sampler2D _BlinkTex;
            float _SpeechAmount;
            float _BlinkAmount;

            struct appdata { float4 vertex : POSITION; float2 uv : TEXCOORD0; };
            struct v2f { float4 vertex : SV_POSITION; float2 uv : TEXCOORD0; };

            v2f vert(appdata v)
            {
                v2f o;
                o.vertex = UnityObjectToClipPos(v.vertex);
                o.uv = v.uv;
                return o;
            }

            float softMask(float2 uv, float2 center, float2 radius)
            {
                float2 p = (uv - center) / radius;
                return 1.0 - smoothstep(0.55, 1.0, length(p));
            }

            fixed4 frag(v2f i) : SV_Target
            {
                fixed4 neutral = tex2D(_MainTex, i.uv);
                fixed4 speaking = tex2D(_SpeakTex, i.uv);
                fixed4 blink = tex2D(_BlinkTex, i.uv);
                float mouth = softMask(i.uv, float2(0.505, 0.663), float2(0.115, 0.057));
                float eyes = softMask(i.uv, float2(0.504, 0.772), float2(0.137, 0.060));
                fixed4 color = lerp(neutral, speaking, saturate(_SpeechAmount) * mouth);
                color = lerp(color, blink, saturate(_BlinkAmount) * eyes);
                return color;
            }
            ENDCG
        }
    }
    FallBack Off
}
